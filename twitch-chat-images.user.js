// ==UserScript==
// @name           Twitch Chat Images
// @namespace      https://github.com/IntermittentlyRupert/
// @version        0.4.0
// @updateURL      https://raw.githubusercontent.com/IntermittentlyRupert/twitch-chat-images/main/twitch-chat-images.user.js
// @downloadURL    https://raw.githubusercontent.com/IntermittentlyRupert/twitch-chat-images/main/twitch-chat-images.user.js
// @description    Inlines images in Twitch chat.
// @author         IntermittentlyRupert
// @icon           https://www.google.com/s2/favicons?domain=twitch.tv
// @match          https://www.twitch.tv/*
// ==/UserScript==

(function () {
  "use strict";

  const CHAT_CONTAINER = ".chat-scrollable-area__message-container";
  const CHAT_SCROLL_PAUSED = ".chat-scrollable-area__message-container--paused";
  const CHAT_LINK = ".chat-line__message a";

  const TWITTER_RE = /^https?:\/\/(www\.)?twitter.com\/([0-9]+)(\?.*)?$/gim;
  const GIPHY_RE = /^https?:\/\/giphy\.com\/gifs\/(.*-)?([a-zA-Z0-9]+)$/gim;
  const IMGUR_RE = /^https?:\/\/(www\.)?imgur.com\/([a-zA-Z0-9]+)$/gim;
  const YOUTUBE_RE =
    /^https?:\/\/(www\.)?(youtu\.be\/|youtube\.com\/watch\?v=)([a-zA-Z0-9\-_]+).*$/gim;
  const IMAGE_RE = /^https?:\/\/.+\.(jpe?g|png|gif|webp|av1)(\?.*)?$/gim;

  const OBSERVER_OPTIONS = { childList: true, subtree: true };

  const LOG_FNS = {
    ERROR: console.error,
    WARN: console.warn,
    INFO: console.log,
    DEBUG: console.debug,
  };

  function log(level, region, ...message) {
    if (level !== "DEBUG") {
      const fn = LOG_FNS[level] || LOG_FNS.INFO;
      fn(`[TCI] ${region} ${level}:`, ...message);
    }
  }

  /**
   * Limit how far exceptions/rejection can bubble and add logging
   *
   * @param {string} fnName
   * @param {T} fn
   * @template T
   * @returns {T}
   */
  function safeWrapper(fnName, fn) {
    return (...args) => {
      try {
        log("DEBUG", fnName, "starts");
        const retVal = fn(...args);

        if (retVal instanceof Promise) {
          return retVal
            .then((result) => {
              log("DEBUG", fnName, "completed");
              return result;
            })
            .catch((e) => {
              log("ERROR", fnName, e);
              return undefined;
            });
        }

        log("DEBUG", fnName, "completed");
        return retVal;
      } catch (e) {
        log("ERROR", fnName, e);
        return undefined;
      }
    };
  }

  /**
   * @param {Node} node
   * @returns {node is Element}
   */
  function isElement(node) {
    return node.nodeType === Node.ELEMENT_NODE;
  }

  /** @returns {Promise<Element>} */
  function detectContainerInsertion() {
    /** @type {MutationObserver | undefined} */
    let ob = undefined;
    return new Promise((resolve) => {
      const existingContainer = document.querySelector(CHAT_CONTAINER);
      if (existingContainer) {
        resolve(existingContainer);
        return;
      }

      ob = new MutationObserver((mutations) => {
        const newContainer = mutations
          .filter((mutation) => mutation.addedNodes)
          .flatMap((mutation) => Array.from(mutation.addedNodes.values()))
          .filter(isElement)
          .find((element) => element.querySelector(CHAT_CONTAINER));
        if (newContainer) {
          resolve(newContainer);
        }
      });
      ob.observe(document, OBSERVER_OPTIONS);
    }).finally(() => {
      if (ob) {
        ob.disconnect();
      }
    });
  }

  function detectContainerRemoval() {
    /** @type {MutationObserver | undefined} */
    let ob = undefined;
    return new Promise((resolve) => {
      if (!document.querySelector(CHAT_CONTAINER)) {
        resolve();
        return;
      }

      ob = new MutationObserver((mutations) => {
        const removedContainer = mutations
          .filter((mutation) => mutation.removedNodes)
          .flatMap((mutation) => Array.from(mutation.removedNodes.values()))
          .filter(isElement)
          .find((element) => element.querySelector(CHAT_CONTAINER));
        if (removedContainer) {
          resolve(removedContainer);
        }
      });
      ob.observe(document, OBSERVER_OPTIONS);
    }).finally(() => {
      if (ob) {
        ob.disconnect();
      }
    });
  }

  function scrollEnabled() {
    return !document.querySelector(CHAT_SCROLL_PAUSED);
  }

  function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  }

  /** @param {Element} element */
  function getScrollAncestor(element) {
    let scrollContainer = element.parentElement;
    while (
      scrollContainer &&
      getComputedStyle(scrollContainer).overflowY !== "scroll"
    ) {
      scrollContainer = scrollContainer.parentElement;
    }
    return scrollContainer;
  }

  /** @param {HTMLImageElement} img */
  function scrollOnHeightChange(img) {
    const scrollContainer = getScrollAncestor(img);
    if (!scrollContainer) {
      log("WARN", "scrollOnHeightChange", "unable to find scroll container");
      return;
    }

    const doScroll = () => {
      log("INFO", "scrollOnHeightChange", "scrolling chat");
      scrollToBottom(scrollContainer);
    };

    const ob = new ResizeObserver(doScroll);
    ob.observe(img);

    img.onload = () => {
      doScroll();
      ob.disconnect();
    };
  }

  /** @param {HTMLAnchorElement} link */
  async function processLink(link) {
    const url = link.textContent
      .trim()
      .replace("media.giphy.com", "media1.giphy.com");

    log("INFO", "processLink", `testing url "${url}"`);
    const matches = {
      twitter: url.match(TWITTER_RE),
      giphy: url.match(GIPHY_RE),
      imgur: url.match(IMGUR_RE),
      youtube: url.match(YOUTUBE_RE),
      image: url.match(IMAGE_RE),
    };
    log("DEBUG", "processLink", "regex matches", matches);

    if (matches.twitter) {
      const id = matches.twitter[2];
      log("INFO", "processLink", "twitter link detected", id);

      if (!twttr || !twttr.init) {
        log("WARN", "processLink", "twitter js not loaded");
        return;
      }

      const tweet = document.createElement("div");
      link.appendChild(tweet);

      await twttr.widgets.createTweet(id, tweet, {
        theme: "dark",
        conversation: "none",
        cards: "hidden",
        dnt: "true",
      });

      if (scrollEnabled()) {
        scrollToBottom(tweet);
      }
      return;
    }

    /** @type {string} */
    let imageUrl;
    if (matches.giphy) {
      const id = matches.giphy[2].split("-").pop();
      log("INFO", "processLink", "giphy link detected", id);
      imageUrl = `https://media1.giphy.com/media/${id}/giphy.gif`;
    } else if (matches.imgur) {
      const id = matches.imgur[2];
      log("INFO", "processLink", "imgur link detected", id);
      // doesn't matter what extension we use so long as it's an image format
      imageUrl = `https://i.imgur.com/${id}.jpg`;
    } else if (matches.youtube) {
      const id = matches.youtube[3];
      log("INFO", "processLink", "youtube link detected", id);
      imageUrl = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    } else if (matches.image) {
      log("INFO", "processLink", "image link detected", url);
      imageUrl = url;
    } else {
      log("INFO", "processLink", "nothing to embed");
      return;
    }

    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = link.textContent;

    link.appendChild(img);

    if (scrollEnabled()) {
      scrollOnHeightChange(img);
    }
  }

  /** @param {MutationRecord[]} mutationsList */
  function onMutation(mutationsList) {
    const newLinks = mutationsList
      .filter((mutation) => mutation.addedNodes)
      .flatMap((mutation) => Array.from(mutation.addedNodes.values()))
      .filter(isElement)
      .flatMap((element) => Array.from(element.querySelectorAll(CHAT_LINK)));
    if (newLinks.length === 0) {
      log("DEBUG", "onMutation", "no new links");
      return;
    }

    log("INFO", "onMutation", `found ${newLinks.length} new links`, newLinks);
    newLinks.forEach(safeWrapper("processLink", processLink));
  }

  async function init() {
    const container = await safeWrapper(
      "detectContainerInsertion",
      detectContainerInsertion
    )();
    log("INFO", "init", "found chat container");

    const ob = new MutationObserver(onMutation);
    ob.observe(container, OBSERVER_OPTIONS);

    await safeWrapper("detectContainerRemoval", detectContainerRemoval)();

    log("WARN", "init", "detected chat container removal - reinitialising");
    ob.disconnect();
    safeWrapper("init", init)();
  }

  const tw = document.createElement("script");
  tw.src = "https://platform.twitter.com/widgets.js";
  document.body.appendChild(tw);

  safeWrapper("init", init)();
})();
