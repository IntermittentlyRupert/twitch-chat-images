// ==UserScript==
// @name           Twitch Chat Images
// @namespace      https://github.com/IntermittentlyRupert/
// @version        0.1.0
// @updateURL      https://raw.githubusercontent.com/IntermittentlyRupert/twitch-chat-images/main/twitch-chat-images.userscript.js
// @downloadURL    https://raw.githubusercontent.com/IntermittentlyRupert/twitch-chat-images/main/twitch-chat-images.userscript.js
// @description    Inlines images in Twitch chat.
// @author         IntermittentlyRupert
// @icon           https://www.google.com/s2/favicons?domain=twitch.tv
// @match          https://www.twitch.tv/*
// ==/UserScript==

(function () {
  "use strict";

  const CHAT_CONTAINER = ".chat-list--default";
  const CHAT_POPOUT = ".chat-list--other";
  const CHAT_LINK = ".chat-line__message a";

  const GIPHY_RE = /^https?:\/\/giphy\.com\/gifs\/(.*-)?([a-zA-Z0-9]+)$/gim;
  const YOUTUBE_RE =
    /^https?:\/\/(www\.)?(youtu\.be\/|youtube\.com\/watch\?v=)([^&?]+).*$/gim;
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

  function getChatContainer(scope = document) {
    return (
      scope.querySelector(CHAT_CONTAINER) || scope.querySelector(CHAT_POPOUT)
    );
  }

  /** @returns {Promise<Element>} */
  function detectContainerInsertion() {
    /** @type {MutationObserver | undefined} */
    let ob = undefined;
    return new Promise((resolve) => {
      const existingContainer = getChatContainer();
      if (existingContainer) {
        resolve(existingContainer);
        return;
      }

      ob = new MutationObserver((mutations) => {
        const newContainer = mutations
          .filter((mutation) => mutation.addedNodes)
          .flatMap((mutation) => Array.from(mutation.addedNodes.values()))
          .filter(isElement)
          .find((element) => getChatContainer(element));
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
      if (!getChatContainer()) {
        resolve();
        return;
      }

      ob = new MutationObserver((mutations) => {
        const removedContainer = mutations
          .filter((mutation) => mutation.removedNodes)
          .flatMap((mutation) => Array.from(mutation.removedNodes.values()))
          .filter(isElement)
          .find((element) => getChatContainer(element));
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

  /** @param {HTMLAnchorElement} link */
  async function processLink(link) {
    const url = link.textContent
      .trim()
      .replace("media.giphy.com", "media1.giphy.com");

    log("INFO", "processLink", `testing url "${url}"`);
    const matches = {
      giphy: url.match(GIPHY_RE),
      youtube: url.match(YOUTUBE_RE),
      image: url.match(IMAGE_RE),
    };
    log("DEBUG", "processLink", "regex matches", matches);

    /** @type {string} */
    let imageUrl;
    if (matches.giphy) {
      const id = matches.giphy[2].split("-").pop();
      log("INFO", "processLink", "giphy link detected", id);
      imageUrl = `https://media1.giphy.com/media/${id}/giphy.gif`;
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
  tw.type = "text/javascript";
  tw.src = "https://platform.twitter.com/widgets.js";
  document.body.appendChild(tw);

  safeWrapper("init", init)();
})();
