"use strict";

(function startPopup() {
  const shared = globalThis.ChatGptToolsShared;
  if (!shared) {
    console.error("[ChatGPT Tools] Popup dependencies did not load");
    return;
  }

  const SLIDER_SAVE_DELAY_MS = 150;

  let enableToggle;
  let keepSlider;
  let keepValueInput;
  let extendedRangeToggle;
  let sliderMinimum;
  let sliderMidpoint;
  let sliderMaximum;
  let showStatusBarCheckbox;
  let collapseLongUserMessagesCheckbox;
  let debugCheckbox;
  let debugGroup;
  let retentionCard;
  let optionsCard;
  let extensionState;
  let extensionStateLabel;
  let exportConversationButton;
  let statusElement;

  let activeTabSupported = false;

  let statusTimer = null;
  let sliderSaveTimer = null;
  let saveQueue = Promise.resolve();

  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Required popup element #${id} was not found`);
    }
    return element;
  }

  function optionalElement(id) {
    return document.getElementById(id);
  }

  function setStatus(message, isError = false, timeoutMs = 3000) {
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }

    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);

    if (timeoutMs > 0) {
      statusTimer = globalThis.setTimeout(() => {
        statusTimer = null;
        statusElement.textContent = "";
        statusElement.classList.remove("error");
      }, timeoutMs);
    }
  }

  function setCardsEnabled(enabled) {
    [retentionCard, optionsCard, debugGroup].forEach((section) => {
      section?.classList.toggle("disabled", !enabled);
    });
  }

  function updateExportButton() {
    exportConversationButton.disabled =
      !activeTabSupported ||
      exportConversationButton.classList.contains("is-loading");
  }

  function updateEnabledPresentation(enabled) {
    enableToggle.checked = enabled;
    extensionState.classList.toggle("is-disabled", !enabled);
    extensionStateLabel.textContent = enabled ? "Active" : "Paused";
    setCardsEnabled(enabled);
    updateExportButton();
  }

  function activeMaximum() {
    return extendedRangeToggle.checked
      ? shared.MAX_KEEP
      : shared.STANDARD_MAX_KEEP;
  }

  function configureSliderRange(extendedRange) {
    const maximum = extendedRange
      ? shared.MAX_KEEP
      : shared.STANDARD_MAX_KEEP;
    const midpoint = extendedRange ? 50 : 10;

    extendedRangeToggle.checked = extendedRange;
    keepSlider.max = String(maximum);
    keepSlider.setAttribute("aria-valuemax", String(maximum));
    keepValueInput.max = String(maximum);
    sliderMinimum.textContent = String(shared.MIN_KEEP);
    sliderMidpoint.textContent = String(midpoint);
    sliderMaximum.textContent = String(maximum);
  }

  function updateSliderPresentation(value) {
    keepSlider.value = String(value);
    keepValueInput.value = String(value);
    keepSlider.setAttribute("aria-valuenow", String(value));
  }

  function clampToActiveRange(value, fallback = shared.DEFAULT_SETTINGS.keep) {
    return shared.clampInteger(
      value,
      shared.MIN_KEEP,
      activeMaximum(),
      fallback
    );
  }

  function renderSettings(settings) {
    configureSliderRange(settings.extendedRange);
    updateSliderPresentation(settings.keep);
    showStatusBarCheckbox.checked = settings.showStatusBar;
    collapseLongUserMessagesCheckbox.checked =
      settings.collapseLongUserMessages;
    if (debugCheckbox) {
      debugCheckbox.checked = settings.debug;
    }
    updateEnabledPresentation(settings.enabled);
  }

  function cancelPendingSliderSave() {
    if (sliderSaveTimer !== null) {
      clearTimeout(sliderSaveTimer);
      sliderSaveTimer = null;
    }
  }

  function queueSave(patch, { silent = false } = {}) {
    saveQueue = saveQueue
      .catch(() => undefined)
      .then(() => shared.writeSettings(patch))
      .then((settings) => {
        if (!silent) {
          setStatus("Settings saved");
        }
        return settings;
      })
      .catch((error) => {
        setStatus("Failed to save settings", true);
        console.error("[ChatGPT Tools] Failed to save settings", error);
        throw error;
      });

    return saveQueue;
  }

  async function getActiveTab() {
    try {
      const tabs = await shared.api.tabs.query({
        active: true,
        currentWindow: true
      });
      return tabs[0] || null;
    } catch (error) {
      console.debug("[ChatGPT Tools] Active tab is unavailable", error);
      return null;
    }
  }

  async function reloadActiveChatGptTab() {
    const tab = await getActiveTab();
    if (!tab?.id || !shared.isSupportedUrl(tab.url)) {
      return false;
    }

    try {
      await shared.api.tabs.reload(tab.id);
      return true;
    } catch (error) {
      console.debug("[ChatGPT Tools] Browser did not reload the active tab", error);
      return false;
    }
  }

  async function updateContextState() {
    const tab = await getActiveTab();
    activeTabSupported = Boolean(tab?.id && shared.isSupportedUrl(tab.url));
    updateExportButton();

    if (!activeTabSupported) {
      setStatus("Open chatgpt.com to optimize a conversation", false, 0);
    }
  }

  async function isDevelopmentBuild() {
    try {
      return (await fetch(shared.api.runtime.getURL(".dev"))).ok;
    } catch {
      return false;
    }
  }

  async function handleEnableChange() {
    const enabled = enableToggle.checked;
    try {
      await queueSave({ enabled });
      updateEnabledPresentation(enabled);
      await reloadActiveChatGptTab();
    } catch {
      updateEnabledPresentation(!enabled);
    }
  }

  async function handleExportConversation() {
    if (exportConversationButton.disabled) {
      return;
    }
    const tab = await getActiveTab();
    if (!tab?.id || !shared.isSupportedUrl(tab.url)) {
      setStatus("Open a ChatGPT conversation first", true, 0);
      return;
    }

    exportConversationButton.classList.add("is-loading");
    updateExportButton();
    setStatus("Opening conversation tools…", false, 0);
    try {
      await shared.api.tabs.sendMessage(tab.id, {
        type: "chatgpt-tools:open-exporter"
      });
      globalThis.close();
    } catch (error) {
      console.debug("[ChatGPT Tools] Browser could not open the exporter", error);
      setStatus("Reload ChatGPT once, then try again", true, 0);
      exportConversationButton.classList.remove("is-loading");
      updateExportButton();
    }
  }

  function handleSliderInput() {
    const keep = clampToActiveRange(keepSlider.value);
    updateSliderPresentation(keep);

    cancelPendingSliderSave();
    sliderSaveTimer = globalThis.setTimeout(() => {
      sliderSaveTimer = null;
      queueSave({ keep }, { silent: true }).catch(() => {});
    }, SLIDER_SAVE_DELAY_MS);
  }

  async function handleSliderChange() {
    cancelPendingSliderSave();
    const keep = clampToActiveRange(keepSlider.value);

    try {
      await queueSave({ keep });
      await reloadActiveChatGptTab();
    } catch {
      // The error is already visible in the status element.
    }
  }

  function handleKeepValueInput() {
    if (keepValueInput.value === "") {
      return;
    }

    const keep = clampToActiveRange(keepValueInput.value, Number.parseInt(keepSlider.value, 10));
    keepSlider.value = String(keep);
    keepSlider.setAttribute("aria-valuenow", String(keep));

    cancelPendingSliderSave();
    sliderSaveTimer = globalThis.setTimeout(() => {
      sliderSaveTimer = null;
      queueSave({ keep }, { silent: true }).catch(() => {});
    }, SLIDER_SAVE_DELAY_MS);
  }

  async function handleKeepValueChange() {
    cancelPendingSliderSave();
    const previousKeep = Number.parseInt(keepSlider.value, 10);
    const keep = clampToActiveRange(keepValueInput.value, previousKeep);
    updateSliderPresentation(keep);

    try {
      await queueSave({ keep });
      await reloadActiveChatGptTab();
    } catch {
      updateSliderPresentation(previousKeep);
    }
  }

  async function handleExtendedRangeChange() {
    cancelPendingSliderSave();

    const previousExtendedRange = !extendedRangeToggle.checked;
    const previousKeep = Number.parseInt(keepSlider.value, 10);
    const extendedRange = extendedRangeToggle.checked;
    configureSliderRange(extendedRange);
    const keep = clampToActiveRange(previousKeep);
    updateSliderPresentation(keep);

    try {
      await queueSave({ extendedRange, keep });
      if (keep !== previousKeep) {
        await reloadActiveChatGptTab();
      }
    } catch {
      configureSliderRange(previousExtendedRange);
      updateSliderPresentation(previousKeep);
    }
  }

  async function initialize() {
    enableToggle = requiredElement("enableToggle");
    keepSlider = requiredElement("keepSlider");
    keepValueInput = requiredElement("keepValueInput");
    extendedRangeToggle = requiredElement("extendedRangeToggle");
    sliderMinimum = requiredElement("sliderMinimum");
    sliderMidpoint = requiredElement("sliderMidpoint");
    sliderMaximum = requiredElement("sliderMaximum");
    statusElement = requiredElement("status");

    showStatusBarCheckbox = requiredElement("showStatusBarCheckbox");
    collapseLongUserMessagesCheckbox = requiredElement(
      "collapseLongUserMessagesCheckbox"
    );
    debugCheckbox = optionalElement("debugCheckbox");
    debugGroup = optionalElement("debugGroup");
    retentionCard = requiredElement("retentionCard");
    optionsCard = requiredElement("optionsCard");
    extensionState = requiredElement("extensionState");
    extensionStateLabel = requiredElement("extensionStateLabel");
    exportConversationButton = requiredElement("exportConversationButton");

    if (await isDevelopmentBuild()) {
      debugGroup.hidden = false;
    }

    const manifest = shared.api.runtime.getManifest();
    document.title = manifest.name || "ChatGPT Tools";
    const platformBadge = optionalElement("platformBadge");
    if (platformBadge) {
      platformBadge.textContent = manifest.name?.includes("Chromium")
        ? "Chromium"
        : "Safari";
    }

    const versionElement = optionalElement("version");
    if (versionElement) {
      versionElement.textContent = `v${manifest.version}`;
    }

    const settings = await shared.readSettings();
    renderSettings(settings);

    enableToggle.addEventListener("change", handleEnableChange);
    keepSlider.addEventListener("input", handleSliderInput);
    keepSlider.addEventListener("change", handleSliderChange);
    keepValueInput.addEventListener("input", handleKeepValueInput);
    keepValueInput.addEventListener("change", handleKeepValueChange);
    keepValueInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        keepValueInput.blur();
      }
    });
    extendedRangeToggle.addEventListener("change", handleExtendedRangeChange);
    exportConversationButton.addEventListener("click", handleExportConversation);

    keepSlider.addEventListener("pointerdown", () => {
      keepValueInput.closest(".ls-value")?.classList.add("is-dragging");
    });
    globalThis.addEventListener("pointerup", () => {
      keepValueInput.closest(".ls-value")?.classList.remove("is-dragging");
    });

    showStatusBarCheckbox.addEventListener("change", () => {
      queueSave({ showStatusBar: showStatusBarCheckbox.checked }).catch(() => {});
    });
    collapseLongUserMessagesCheckbox.addEventListener("change", () => {
      queueSave({
        collapseLongUserMessages: collapseLongUserMessagesCheckbox.checked
      }).catch(() => {});
    });
    debugCheckbox?.addEventListener("change", () => {
      queueSave({ debug: debugCheckbox.checked }).catch(() => {});
    });

    await updateContextState();
  }

  const start = () => {
    initialize().catch((error) => {
      console.error("[ChatGPT Tools] Popup failed to initialize", error);
      if (statusElement) {
        setStatus("Failed to load settings", true, 0);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
