(() => {
    const root = document.documentElement;
    const editor = document.getElementById("note-editor");
    const editorForm = document.querySelector(".editor-form");
    const searchHighlights = document.getElementById("search-highlights");
    const status = document.getElementById("save-status");
    const themeButton = document.getElementById("theme-toggle");
    const searchInput = document.getElementById("note-search");
    const searchCount = document.getElementById("search-count");
    const copyUrlButton = document.getElementById("copy-url");
    const copyTextButton = document.getElementById("copy-text");
    const slugSelect = document.getElementById("slug-select");
    const notePassword = document.getElementById("note-password");
    const passwordToggleButtons = document.querySelectorAll("[data-password-toggle]");
    const setPasswordButton = document.getElementById("set-password");
    const clearPasswordButton = document.getElementById("clear-password");
    const historySelect = document.getElementById("history-select");
    const restoreHistoryButton = document.getElementById("restore-history");
    const lockPanel = document.getElementById("lock-panel");
    const unlockPassword = document.getElementById("unlock-password");
    const unlockButton = document.getElementById("unlock-note");
    const lockMessage = document.getElementById("lock-message");
    const attachLabel = document.getElementById("attach-label");
    const fileInput = document.getElementById("file-input");
    const fileActions = document.getElementById("file-actions");
    const fileName = document.getElementById("file-name");
    const downloadFile = document.getElementById("download-file");
    const deleteFile = document.getElementById("delete-file");
    const fileStatus = document.getElementById("file-status");
    const lineCount = document.getElementById("line-count");
    const lineCountWrap = document.getElementById("line-count-wrap");
    const wordCount = document.getElementById("word-count");
    const characterCount = document.getElementById("character-count");
    const toolsSidebar = document.getElementById("tools-sidebar");
    const toolsToggle = document.getElementById("tools-toggle");
    const sidebarClose = document.getElementById("sidebar-close");
    const sidebarScrim = document.getElementById("sidebar-scrim");
    const toolTargetButtons = document.querySelectorAll("[data-tool-target]");
    const editorFocusButtons = document.querySelectorAll("[data-editor-focus]");
    const searchFocusButtons = document.querySelectorAll("[data-search-focus]");
    const copyNoteButtons = document.querySelectorAll("[data-copy-note]");
    const openToolsButtons = document.querySelectorAll("[data-open-tools]");
    const attachFileButtons = document.querySelectorAll("[data-attach-file]");
    const themeOptionButtons = document.querySelectorAll("[data-theme-option]");
    const sidebarSections = document.querySelectorAll(".sidebar-section");
    const mobileToolTabs = document.querySelector(".mobile-tool-tabs");
    const noteTitle = document.getElementById("note-title");
    const replaceToggle = document.getElementById("replace-toggle");
    const replaceFindInput = document.getElementById("replace-find-input");
    const replaceInput = document.getElementById("replace-input");
    const replaceMatchButtons = document.querySelectorAll("[data-replace-match]");
    const replaceCount = document.getElementById("replace-count");
    const replaceAllButton = document.getElementById("replace-all");
    const replaceResult = document.getElementById("replace-result");
    const textStyleMenu = document.getElementById("text-style-menu");
    const textStyleToggle = document.getElementById("text-style-toggle");
    const textStylePanel = document.getElementById("text-style-panel");
    const mobileStyleSlot = document.getElementById("mobile-style-slot");
    const textColorButtons = document.querySelectorAll("[data-text-color]");
    const customTextColor = document.getElementById("custom-text-color");
    const textWeightButtons = document.querySelectorAll("[data-text-weight]");
    const titleCaseButton = document.getElementById("title-case");
    const undoToast = document.getElementById("undo-toast");
    const undoMessage = document.getElementById("undo-message");
    const undoAction = document.getElementById("undo-action");
    const recentNotes = document.getElementById("recent-notes");
    const historyDetail = document.getElementById("history-detail");
    const historyChangeSummary = document.getElementById("history-change-summary");
    const historyTime = document.getElementById("history-time");
    const historyContent = document.getElementById("history-content");
    const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;
    const apiUrl = editor.dataset.apiUrl;
    const fileUrl = editor.dataset.fileUrl;
    const unlockUrl = editor.dataset.unlockUrl;
    const passwordUrl = editor.dataset.passwordUrl;
    const historyUrl = editor.dataset.historyUrl;
    const SAVE_DELAY_MS = 450;
    const FAST_REFRESH_MS = 3000;
    const ACTIVE_REFRESH_MS = 10000;
    const WARM_REFRESH_MS = 30000;
    const IDLE_REFRESH_MS = 60000;
    const LONG_IDLE_REFRESH_MS = 5 * 60 * 1000;
    const MAX_NOTE_LINES = 5000;
    const noteSlug = slugSelect.dataset.currentSlug;
    const draftKey = `notepad-draft:${noteSlug}`;
    const legacyTextStyleKey = `notepad-text-style:${noteSlug}`;
    const recentNotesKey = "notepad-recent-notes";
    const THEME_LABELS = {
        dark: "Dark",
        light: "Light",
        telegram: "Glass",
        ivory: "Ivory Ledger",
        graphite: "Graphite Desk",
        oxford: "Oxford Navy",
    };

    let noteLocked = editor.dataset.locked === "true";
    let hasPassword = editor.dataset.hasPassword === "true";
    let lastSavedContent = editor.value;
    let lastSavedTitle = noteTitle.value.trim();
    let textColor = editor.dataset.textColor;
    let textWeight = editor.dataset.textWeight;
    let lastSavedTextColor = textColor;
    let lastSavedTextWeight = textWeight;
    let lastSavedAt = editor.dataset.updatedAt ? new Date(editor.dataset.updatedAt) : null;
    let saveInProgress = false;
    let activeSavePromise = null;
    let pollInProgress = false;
    let saveTimer = null;
    let pollTimer = null;
    let pendingOfflineSave = false;
    let lastActivityAt = Date.now();
    let searchMatches = [];
    let replaceMatches = [];
    let replaceMatchMode = "characters";
    let highlightMode = "search";
    let activeMatchIndex = -1;
    let currentToolTarget = "note-tools";
    let historyItems = [];
    let undoSnapshot = null;
    let undoTimer = null;
    let wasCompactToolsLayout = window.matchMedia("(max-width: 1100px)").matches;

    function setStatus(label, state) {
        status.textContent = label;
        status.dataset.state = state;
    }

    function updateThemeControls() {
        const themeName = THEME_LABELS[root.dataset.theme] || THEME_LABELS.dark;
        themeButton.title = `Choose theme (${themeName})`;
        themeButton.setAttribute("aria-label", `Choose theme. Current theme: ${themeName}`);
        themeOptionButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.themeOption === root.dataset.theme);
        });
    }

    function hasUnsavedChanges() {
        return editor.value !== lastSavedContent
            || noteTitle.value.trim() !== lastSavedTitle
            || textColor !== lastSavedTextColor
            || textWeight !== lastSavedTextWeight;
    }

    function updatePageTitle() {
        document.title = noteTitle.value.trim() || `Note ${noteSlug}`;
    }

    function savedLabel() {
        if (!lastSavedAt || Number.isNaN(lastSavedAt.getTime())) {
            return "Saved";
        }
        const seconds = Math.max(0, Math.floor((Date.now() - lastSavedAt.getTime()) / 1000));
        if (seconds < 5) {
            return "Saved just now";
        }
        if (seconds < 60) {
            return `Saved ${seconds}s ago`;
        }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `Saved ${minutes}m ago`;
        }
        return `Saved ${lastSavedAt.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`;
    }

    function showSaved(updatedAt = null) {
        if (updatedAt) {
            lastSavedAt = new Date(updatedAt);
        }
        pendingOfflineSave = false;
        setStatus(savedLabel(), "saved");
    }

    function refreshSavedStatus() {
        if (status.dataset.state === "saved") {
            status.textContent = savedLabel();
        }
    }

    function updateLockState() {
        editor.disabled = noteLocked;
        noteTitle.disabled = noteLocked;
        editorForm.classList.toggle("is-locked", noteLocked);
        lockPanel.hidden = !noteLocked;
        searchInput.disabled = noteLocked;
        copyTextButton.disabled = noteLocked;
        attachLabel.classList.toggle("is-disabled", noteLocked);
        notePassword.disabled = noteLocked;
        setPasswordButton.disabled = noteLocked;
        clearPasswordButton.hidden = !hasPassword || noteLocked;
        historySelect.disabled = noteLocked;
        restoreHistoryButton.disabled = noteLocked || !historySelect.value;
        replaceFindInput.disabled = noteLocked;
        replaceInput.disabled = noteLocked;
        replaceMatchButtons.forEach((button) => {
            button.disabled = noteLocked;
        });
        replaceAllButton.disabled = noteLocked;
        titleCaseButton.disabled = noteLocked;
        attachFileButtons.forEach((button) => {
            button.disabled = noteLocked;
        });
        if (noteLocked) {
            setStatus("Locked", "error");
            unlockPassword.focus();
        } else {
            showSaved();
        }
    }

    function togglePasswordVisibility(button) {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) {
            return;
        }
        const shouldShow = input.type === "password";
        input.type = shouldShow ? "text" : "password";
        button.classList.toggle("is-visible", shouldShow);
        button.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
        button.title = shouldShow ? "Hide password" : "Show password";
        input.focus({preventScroll: true});
    }

    function updateCounts() {
        const content = editor.value;
        const lines = content ? content.split("\n").length : 0;
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        lineCount.textContent = `${lines} / ${MAX_NOTE_LINES}`;
        lineCountWrap.classList.toggle("is-warning", lines >= MAX_NOTE_LINES);
        wordCount.textContent = words;
        characterCount.textContent = content.length;
    }

    function saveLocalDraft() {
        localStorage.setItem(draftKey, JSON.stringify({
            title: noteTitle.value,
            content: editor.value,
            textColor,
            textWeight,
            savedAt: Date.now(),
        }));
    }

    function restoreLocalDraft() {
        if (noteLocked) {
            return;
        }
        try {
            const draft = JSON.parse(localStorage.getItem(draftKey));
            if (!draft) {
                return;
            }
            const draftTitle = typeof draft.title === "string" ? draft.title : noteTitle.value;
            const draftColor = draft.textColor || textColor;
            const draftWeight = draft.textWeight || textWeight;
            if (
                draft.content === lastSavedContent
                && draftTitle.trim() === lastSavedTitle
                && draftColor === lastSavedTextColor
                && draftWeight === lastSavedTextWeight
            ) {
                return;
            }
            editor.value = typeof draft.content === "string" ? draft.content : editor.value;
            noteTitle.value = draftTitle;
            setTextStyle(draftColor, draftWeight, false);
            pendingOfflineSave = true;
            setStatus("Draft recovered", "saving");
            updateCounts();
            updateSearchMatches();
            updateReplaceMatches();
            scheduleSave();
        } catch (error) {
            localStorage.removeItem(draftKey);
        }
    }

    function renderRecentNotes() {
        recentNotes.replaceChildren();
        let items = [];
        try {
            items = JSON.parse(localStorage.getItem(recentNotesKey)) || [];
        } catch (error) {
            localStorage.removeItem(recentNotesKey);
        }

        if (!items.length) {
            const empty = document.createElement("span");
            empty.className = "recent-notes-empty";
            empty.textContent = "No recent notes yet";
            recentNotes.append(empty);
            return;
        }

        items.slice(0, 6).forEach((item) => {
            const link = document.createElement("a");
            link.className = "recent-note-link";
            link.href = `/${encodeURIComponent(item.slug)}/`;
            const title = document.createElement("span");
            const slug = document.createElement("small");
            title.textContent = item.title || "Untitled note";
            slug.textContent = item.slug;
            link.append(title, slug);
            recentNotes.append(link);
        });
    }

    function rememberCurrentNote() {
        let items = [];
        try {
            items = JSON.parse(localStorage.getItem(recentNotesKey)) || [];
        } catch (error) {
            items = [];
        }
        items = items.filter((item) => item.slug !== noteSlug);
        items.unshift({slug: noteSlug, title: noteTitle.value.trim(), openedAt: Date.now()});
        localStorage.setItem(recentNotesKey, JSON.stringify(items.slice(0, 6)));
        renderRecentNotes();
    }

    function replaceEveryMatch() {
        const expression = replaceExpression();
        if (!expression) {
            replaceResult.textContent = "Enter text to find.";
            replaceFindInput.focus();
            return;
        }
        const matches = editor.value.match(expression);
        if (!matches) {
            replaceResult.textContent = "No matches found.";
            return;
        }

        rememberUndo(`Replaced ${matches.length} ${matches.length === 1 ? "match" : "matches"}`);
        editor.value = editor.value.replace(expression, () => replaceInput.value);
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        replaceResult.textContent = `Replaced ${matches.length} ${matches.length === 1 ? "match" : "matches"}.`;
    }

    function replaceExpression() {
        if (!replaceFindInput.value) {
            return null;
        }
        const escapedQuery = replaceFindInput.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wholeWord = `(?<![\\p{L}\\p{N}_])${escapedQuery}(?![\\p{L}\\p{N}_])`;
        const pattern = replaceMatchMode === "word" ? wholeWord : escapedQuery;
        return new RegExp(pattern, "giu");
    }

    function trimToMaxLines(value) {
        const lines = value.split("\n");
        if (lines.length <= MAX_NOTE_LINES) {
            return value;
        }
        return lines.slice(0, MAX_NOTE_LINES).join("\n");
    }

    function enforceLineLimit() {
        const trimmedValue = trimToMaxLines(editor.value);
        if (trimmedValue === editor.value) {
            return false;
        }

        const cursorPosition = Math.min(editor.selectionStart, trimmedValue.length);
        editor.value = trimmedValue;
        editor.setSelectionRange(cursorPosition, cursorPosition);
        setStatus("Line limit", "error");
        return true;
    }

    function updateSearchMatches(resetPosition = false) {
        const query = searchInput.value;
        searchMatches = [];

        if (!query) {
            activeMatchIndex = -1;
            searchCount.textContent = "";
            searchCount.classList.remove("is-empty");
            renderSearchHighlights();
            return;
        }

        const content = editor.value.toLocaleLowerCase();
        const normalizedQuery = query.toLocaleLowerCase();
        let position = 0;

        while ((position = content.indexOf(normalizedQuery, position)) !== -1) {
            searchMatches.push(position);
            position += Math.max(normalizedQuery.length, 1);
        }

        if (resetPosition) {
            activeMatchIndex = -1;
        } else if (activeMatchIndex >= searchMatches.length) {
            activeMatchIndex = searchMatches.length - 1;
        }

        searchCount.classList.toggle("is-empty", searchMatches.length === 0);
        searchCount.textContent = searchMatches.length
            ? (
                activeMatchIndex >= 0
                    ? `${activeMatchIndex + 1} / ${searchMatches.length}`
                    : `${searchMatches.length} matches`
            )
            : "No matches";
        renderSearchHighlights();
    }

    function updateReplaceMatches() {
        const expression = replaceExpression();
        replaceMatches = expression
            ? [...editor.value.matchAll(expression)].map((match) => match.index)
            : [];
        replaceCount.textContent = `${replaceMatches.length} ${replaceMatches.length === 1 ? "match" : "matches"}`;
        replaceResult.textContent = "";
        renderSearchHighlights();
    }

    function renderSearchHighlights() {
        searchHighlights.replaceChildren();

        const showingReplace = highlightMode === "replace";
        const query = showingReplace ? replaceFindInput.value : searchInput.value;
        const matches = showingReplace ? replaceMatches : searchMatches;

        if (!query || !matches.length) {
            searchHighlights.textContent = editor.value;
            syncHighlightScroll();
            return;
        }

        let cursor = 0;
        matches.forEach((start, index) => {
            searchHighlights.append(
                document.createTextNode(editor.value.slice(cursor, start)),
            );

            const mark = document.createElement("mark");
            mark.textContent = editor.value.slice(
                start,
                start + query.length,
            );
            if (showingReplace) {
                mark.classList.add("is-replace-match");
            } else if (index === activeMatchIndex) {
                mark.classList.add("is-active");
            }
            searchHighlights.append(mark);
            cursor = start + query.length;
        });
        searchHighlights.append(
            document.createTextNode(editor.value.slice(cursor)),
        );
        syncHighlightScroll();
    }

    function syncHighlightScroll() {
        searchHighlights.scrollTop = editor.scrollTop;
        searchHighlights.scrollLeft = editor.scrollLeft;
    }

    function selectSearchMatch(direction) {
        updateSearchMatches();
        if (!searchMatches.length) {
            return;
        }

        activeMatchIndex =
            (activeMatchIndex + direction + searchMatches.length)
            % searchMatches.length;
        const start = searchMatches[activeMatchIndex];
        const end = start + searchInput.value.length;

        editor.focus();
        editor.setSelectionRange(start, end);
        searchInput.focus({preventScroll: true});
        searchCount.textContent = `${activeMatchIndex + 1} / ${searchMatches.length}`;
        renderSearchHighlights();
        window.requestAnimationFrame(syncHighlightScroll);
    }

    function formatBytes(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function renderAttachment(attachment) {
        const hasAttachment = Boolean(attachment);
        attachLabel.hidden = hasAttachment;
        attachFileButtons.forEach((button) => {
            button.hidden = hasAttachment;
        });
        fileActions.hidden = !hasAttachment;

        if (!hasAttachment) {
            fileName.textContent = "";
            downloadFile.removeAttribute("href");
            fileStatus.textContent = "";
            return;
        }

        fileName.textContent = `${attachment.name} (${formatBytes(attachment.size)})`;
        fileName.title = attachment.name;
        downloadFile.href = attachment.download_url;
        fileStatus.textContent = attachment.expires_at
            ? "Files over 5 MB expire after 3 hours"
            : "";
    }

    function scheduleSave() {
        window.clearTimeout(saveTimer);
        saveTimer = null;

        if (noteLocked || !hasUnsavedChanges()) {
            return;
        }

        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            saveIfChanged();
        }, SAVE_DELAY_MS);
    }

    function compactToolsLayout() {
        return window.matchMedia("(max-width: 1100px)").matches;
    }

    function setTextStyle(color, weight, shouldSave = true) {
        textColor = color;
        textWeight = String(weight);
        editor.dataset.textColor = color;
        editor.style.setProperty("--note-text-color", color === "default" ? "var(--text)" : color);
        editor.style.fontWeight = textWeight;

        let presetColor = false;
        textColorButtons.forEach((button) => {
            const selected = button.dataset.textColor === color;
            button.classList.toggle("is-active", selected);
            presetColor ||= selected;
        });
        customTextColor.parentElement.classList.toggle("is-active", !presetColor);
        if (!presetColor && /^#[0-9a-f]{6}$/i.test(color)) {
            customTextColor.value = color;
        }
        textWeightButtons.forEach((button) => {
            const selected = button.dataset.textWeight === textWeight;
            button.classList.toggle("is-active", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
        if (shouldSave && hasUnsavedChanges()) {
            markActivity();
            saveLocalDraft();
            setStatus("Saving style...", "saving");
            scheduleSave();
            saveIfChanged();
        } else if (shouldSave) {
            localStorage.removeItem(draftKey);
            showSaved();
        }
    }

    function syncTextStylePanel() {
        if (compactToolsLayout()) {
            mobileStyleSlot.append(textStylePanel);
            textStylePanel.hidden = false;
            return;
        }
        textStyleMenu.append(textStylePanel);
        textStylePanel.hidden = true;
        textStyleToggle.setAttribute("aria-expanded", "false");
    }

    function restoreLegacyTextStyle() {
        const savedStyle = localStorage.getItem(legacyTextStyleKey);
        if (!savedStyle || textColor !== "default" || textWeight !== "400") {
            localStorage.removeItem(legacyTextStyleKey);
            return;
        }
        try {
            const style = JSON.parse(savedStyle);
            const validColor = style.color === "default" || /^#[0-9a-f]{6}$/i.test(style.color);
            const validWeight = ["400", "500", "700"].includes(String(style.weight));
            if (validColor && validWeight) {
                setTextStyle(style.color, String(style.weight));
            }
        } catch (error) {
            console.warn("Ignoring an invalid saved text style.");
        } finally {
            localStorage.removeItem(legacyTextStyleKey);
        }
    }

    function applyTitleCase() {
        let start = editor.selectionStart;
        let end = editor.selectionEnd;

        if (start === end) {
            start = editor.value.lastIndexOf("\n", start - 1) + 1;
            const lineEnd = editor.value.indexOf("\n", end);
            end = lineEnd === -1 ? editor.value.length : lineEnd;
        }

        const title = editor.value.slice(start, end).replace(
            /\p{L}[\p{L}\p{M}\p{N}'’_-]*/gu,
            (word) => word[0].toLocaleUpperCase() + word.slice(1),
        );
        if (title === editor.value.slice(start, end)) {
            return;
        }
        rememberUndo("Changed to Title Case");
        editor.setRangeText(title, start, end, "select");
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        editor.focus();
    }

    function rememberUndo(message) {
        window.clearTimeout(undoTimer);
        undoSnapshot = {
            content: editor.value,
            selectionStart: editor.selectionStart,
            selectionEnd: editor.selectionEnd,
        };
        undoMessage.textContent = message;
        undoToast.hidden = false;
        undoTimer = window.setTimeout(hideUndo, 10000);
    }

    function hideUndo() {
        undoToast.hidden = true;
        undoSnapshot = null;
        undoTimer = null;
    }

    function updateMobileTabFade() {
        const maxScroll = mobileToolTabs.scrollWidth - mobileToolTabs.clientWidth;
        mobileToolTabs.classList.toggle("is-at-start", mobileToolTabs.scrollLeft < 2);
        mobileToolTabs.classList.toggle("is-at-end", mobileToolTabs.scrollLeft > maxScroll - 2);
    }

    function setToolsOpen(open, targetId = null) {
        const shouldOpen = Boolean(open);
        if (targetId) {
            currentToolTarget = targetId;
        }
        toolsSidebar.classList.toggle("is-open", shouldOpen);
        toolsToggle.setAttribute("aria-expanded", String(shouldOpen));
        toolsToggle.setAttribute("aria-label", shouldOpen ? "Hide tools" : "Show tools");
        toolsToggle.title = shouldOpen ? "Hide tools" : "Show tools";

        if (shouldOpen) {
            toolTargetButtons.forEach((button) => {
                button.classList.toggle("is-active", button.dataset.toolTarget === currentToolTarget);
            });
            editorFocusButtons.forEach((button) => button.classList.remove("is-active"));
            sidebarSections.forEach((section) => {
                section.classList.toggle("is-active", section.id === currentToolTarget);
            });
            window.requestAnimationFrame(() => {
                document.getElementById(currentToolTarget)?.scrollIntoView({block: "start", behavior: "smooth"});
                const activeMobileTab = mobileToolTabs.querySelector(`[data-tool-target="${currentToolTarget}"]`);
                activeMobileTab?.scrollIntoView({block: "nearest", inline: "center", behavior: "smooth"});
                updateMobileTabFade();
            });
        } else {
            toolTargetButtons.forEach((button) => button.classList.remove("is-active"));
            editorFocusButtons.forEach((button) => button.classList.add("is-active"));
        }
    }

    function openToolSection(targetId) {
        setToolsOpen(true, targetId);
    }

    function getRefreshDelay() {
        const inactiveFor = Date.now() - lastActivityAt;

        if (inactiveFor < 20000) {
            return FAST_REFRESH_MS;
        }
        if (inactiveFor < 60000) {
            return ACTIVE_REFRESH_MS;
        }
        if (inactiveFor < 5 * 60 * 1000) {
            return WARM_REFRESH_MS;
        }
        if (inactiveFor < 15 * 60 * 1000) {
            return IDLE_REFRESH_MS;
        }
        return LONG_IDLE_REFRESH_MS;
    }

    function scheduleRemoteRefresh(delay = getRefreshDelay()) {
        window.clearTimeout(pollTimer);
        pollTimer = null;

        if (document.hidden || noteLocked) {
            return;
        }

        pollTimer = window.setTimeout(async () => {
            pollTimer = null;
            await loadRemoteChanges();
            scheduleRemoteRefresh();
        }, delay);
    }

    function markActivity() {
        lastActivityAt = Date.now();
        scheduleRemoteRefresh(FAST_REFRESH_MS);
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.headers || {}),
            },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || `Request failed with status ${response.status}`);
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data;
    }

    async function saveIfChanged() {
        if (noteLocked) {
            return false;
        }
        if (saveInProgress) {
            return activeSavePromise;
        }
        if (!hasUnsavedChanges()) {
            return true;
        }

        const contentToSave = editor.value;
        const titleToSave = noteTitle.value.trim();
        const colorToSave = textColor;
        const weightToSave = Number(textWeight);
        const savePayload = {};
        if (contentToSave !== lastSavedContent) savePayload.content = contentToSave;
        if (titleToSave !== lastSavedTitle) savePayload.title = titleToSave;
        if (colorToSave !== lastSavedTextColor) savePayload.text_color = colorToSave;
        if (String(weightToSave) !== lastSavedTextWeight) savePayload.text_weight = weightToSave;
        saveInProgress = true;
        setStatus("Saving...", "saving");

        activeSavePromise = (async () => {
            try {
                const data = await fetchJson(apiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": csrfToken,
                    },
                    body: JSON.stringify(savePayload),
                });

                lastSavedContent = data.content;
                lastSavedTitle = data.title;
                lastSavedTextColor = data.text_color;
                lastSavedTextWeight = String(data.text_weight);
                if (noteTitle.value.trim() === titleToSave) {
                    noteTitle.value = data.title;
                }
                if (textColor === colorToSave && textWeight === String(weightToSave)) {
                    setTextStyle(data.text_color, String(data.text_weight), false);
                }
                updatePageTitle();
                if (hasUnsavedChanges()) {
                    saveLocalDraft();
                } else {
                    localStorage.removeItem(draftKey);
                }
                renderAttachment(data.attachment);
                showSaved(data.updated_at);
                rememberCurrentNote();
                scheduleRemoteRefresh(FAST_REFRESH_MS);
                loadHistory();
                if (hasUnsavedChanges()) {
                    setStatus("Typing...", "typing");
                }
                return true;
            } catch (error) {
                console.error(error);
                pendingOfflineSave = true;
                setStatus(navigator.onLine ? "Save pending" : "Offline pending", "error");
                return false;
            } finally {
                saveInProgress = false;
                activeSavePromise = null;
                if (hasUnsavedChanges() && !pendingOfflineSave) {
                    scheduleSave();
                }
            }
        })();

        return activeSavePromise;
    }

    async function loadRemoteChanges() {
        if (
            document.hidden
            || noteLocked
            || pollInProgress
            || saveInProgress
            || hasUnsavedChanges()
        ) {
            return;
        }

        pollInProgress = true;
        try {
            const data = await fetchJson(apiUrl, {cache: "no-store"});
            let remoteChanged = false;
            if (data.content !== lastSavedContent) {
                editor.value = data.content;
                lastSavedContent = data.content;
                lastActivityAt = Date.now();
                updateCounts();
                updateSearchMatches();
                updateReplaceMatches();
                remoteChanged = true;
            }
            if (data.title !== lastSavedTitle) {
                noteTitle.value = data.title || "";
                lastSavedTitle = data.title || "";
                updatePageTitle();
                rememberCurrentNote();
                remoteChanged = true;
            }
            if (
                data.text_color !== lastSavedTextColor
                || String(data.text_weight) !== lastSavedTextWeight
            ) {
                lastSavedTextColor = data.text_color;
                lastSavedTextWeight = String(data.text_weight);
                setTextStyle(lastSavedTextColor, lastSavedTextWeight, false);
                remoteChanged = true;
            }
            if (remoteChanged) {
                showSaved(data.updated_at);
            }
            hasPassword = Boolean(data.has_password);
            clearPasswordButton.hidden = !hasPassword;
            renderAttachment(data.attachment);
        } catch (error) {
            if (error.status === 423) {
                noteLocked = true;
                updateLockState();
            } else {
                console.error(error);
            }
        } finally {
            pollInProgress = false;
        }
    }

    function renderHistory(items) {
        historyItems = items;
        historySelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = items.length ? "Choose version" : "No history";
        historySelect.append(placeholder);

        items.forEach((item) => {
            const option = document.createElement("option");
            option.value = item.id;
            const when = new Date(item.created_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            });
            option.textContent = `${when} - ${item.preview}`;
            historySelect.append(option);
        });
        restoreHistoryButton.disabled = noteLocked || !historySelect.value;
        historyDetail.hidden = true;
    }

    function showHistoryDetails() {
        const item = historyItems.find((history) => String(history.id) === historySelect.value);
        if (!item) {
            historyDetail.hidden = true;
            return;
        }
        const previousLines = item.content.split("\n");
        const currentLines = editor.value.split("\n");
        const changedLines = Math.max(previousLines.length, currentLines.length)
            - previousLines.filter((line, index) => line === currentLines[index]).length;
        historyChangeSummary.textContent = `${changedLines} changed line${changedLines === 1 ? "" : "s"}`;
        historyTime.textContent = new Date(item.created_at).toLocaleString();
        historyContent.textContent = item.content || "Empty note";
        historyDetail.hidden = false;
    }

    async function loadHistory() {
        if (noteLocked) {
            renderHistory([]);
            return;
        }
        try {
            const data = await fetchJson(historyUrl, {cache: "no-store"});
            renderHistory(data.history || []);
        } catch (error) {
            console.error(error);
        }
    }

    async function copyValue(value) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return;
        }

        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = value;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.appendChild(temporaryInput);
        temporaryInput.select();
        const copied = document.execCommand("copy");
        temporaryInput.remove();

        if (!copied) {
            throw new Error("Clipboard copy was rejected.");
        }
    }

    async function handleCopy(button, value) {
        const originalLabel = button.textContent;
        try {
            await copyValue(value);
            button.textContent = "Copied";
        } catch (error) {
            console.error(error);
            button.textContent = "Copy failed";
        }
        window.setTimeout(() => {
            button.textContent = originalLabel;
        }, 1400);
    }

    editor.addEventListener("input", () => {
        markActivity();
        const wasTrimmed = enforceLineLimit();
        updateCounts();
        updateSearchMatches();
        updateReplaceMatches();
        saveLocalDraft();
        if (!hasUnsavedChanges()) {
            localStorage.removeItem(draftKey);
            window.clearTimeout(saveTimer);
            saveTimer = null;
            showSaved();
        } else {
            pendingOfflineSave = false;
            if (!wasTrimmed) {
                setStatus("Typing...", "typing");
            }
            scheduleSave();
        }
    });

    noteTitle.addEventListener("input", () => {
        markActivity();
        updatePageTitle();
        saveLocalDraft();
        if (hasUnsavedChanges()) {
            setStatus("Typing...", "typing");
            scheduleSave();
        } else {
            localStorage.removeItem(draftKey);
            showSaved();
        }
    });

    editor.addEventListener("scroll", syncHighlightScroll);

    searchInput.addEventListener("input", () => {
        highlightMode = "search";
        updateSearchMatches(true);
    });

    searchInput.addEventListener("focus", () => {
        highlightMode = "search";
        renderSearchHighlights();
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            selectSearchMatch(event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape") {
            searchInput.value = "";
            updateSearchMatches(true);
            editor.focus();
        }
    });

    replaceToggle.addEventListener("click", () => {
        openToolSection("replace-tools");
        highlightMode = "replace";
        updateReplaceMatches();
        window.requestAnimationFrame(() => replaceFindInput.focus());
    });

    replaceFindInput.addEventListener("input", () => {
        highlightMode = "replace";
        updateReplaceMatches();
    });

    replaceFindInput.addEventListener("focus", () => {
        highlightMode = "replace";
        renderSearchHighlights();
    });

    replaceMatchButtons.forEach((button) => {
        button.addEventListener("click", () => {
            replaceMatchMode = button.dataset.replaceMatch;
            replaceMatchButtons.forEach((option) => {
                const selected = option === button;
                option.classList.toggle("is-active", selected);
                option.setAttribute("aria-pressed", String(selected));
            });
            highlightMode = "replace";
            updateReplaceMatches();
        });
    });

    replaceAllButton.addEventListener("click", replaceEveryMatch);

    textStyleToggle.addEventListener("click", () => {
        if (!textStyleMenu.contains(textStylePanel)) {
            textStyleMenu.append(textStylePanel);
            textStylePanel.hidden = true;
        }
        const open = textStylePanel.hidden;
        textStylePanel.hidden = !open;
        textStyleToggle.setAttribute("aria-expanded", String(open));
    });

    textColorButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setTextStyle(button.dataset.textColor, textWeight);
        });
    });

    customTextColor.addEventListener("input", () => {
        setTextStyle(customTextColor.value, textWeight);
    });

    textWeightButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setTextStyle(textColor, button.dataset.textWeight);
        });
    });

    titleCaseButton.addEventListener("click", applyTitleCase);

    undoAction.addEventListener("click", () => {
        if (!undoSnapshot) {
            return;
        }
        const snapshot = undoSnapshot;
        hideUndo();
        editor.value = snapshot.content;
        editor.dispatchEvent(new Event("input", {bubbles: true}));
        editor.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        editor.focus();
    });

    mobileToolTabs.addEventListener("scroll", updateMobileTabFade, {passive: true});

    toolsToggle.addEventListener("click", () => {
        setToolsOpen(!toolsSidebar.classList.contains("is-open"));
    });

    sidebarClose.addEventListener("click", () => setToolsOpen(false));
    sidebarScrim.addEventListener("click", () => setToolsOpen(false));

    toolTargetButtons.forEach((button) => {
        button.addEventListener("click", () => {
            openToolSection(button.dataset.toolTarget);
            if (button.dataset.toolTarget === "replace-tools") {
                highlightMode = "replace";
                updateReplaceMatches();
            }
            if (button.dataset.toolTarget === "style-tools") {
                mobileStyleSlot.append(textStylePanel);
                textStylePanel.hidden = false;
            }
        });
    });

    editorFocusButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setToolsOpen(false);
            window.requestAnimationFrame(() => editor.focus());
        });
    });

    searchFocusButtons.forEach((button) => {
        button.addEventListener("click", () => {
            setToolsOpen(false);
            highlightMode = "search";
            updateSearchMatches();
            window.requestAnimationFrame(() => searchInput.focus());
        });
    });

    copyNoteButtons.forEach((button) => {
        button.addEventListener("click", () => copyTextButton.click());
    });

    openToolsButtons.forEach((button) => {
        button.addEventListener("click", () => setToolsOpen(true));
    });

    attachFileButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (!noteLocked) {
                fileInput.click();
            }
        });
    });

    themeOptionButtons.forEach((button) => {
        button.addEventListener("click", () => {
            root.dataset.theme = button.dataset.themeOption;
            localStorage.setItem("note-theme", root.dataset.theme);
            updateThemeControls();
        });
    });

    document.addEventListener("keydown", (event) => {
        const shortcut = event.ctrlKey || event.metaKey;
        if (shortcut && event.key.toLowerCase() === "k") {
            event.preventDefault();
            highlightMode = "search";
            updateSearchMatches();
            searchInput.focus();
            return;
        }
        if (shortcut && event.shiftKey && event.key.toLowerCase() === "c") {
            event.preventDefault();
            copyTextButton.click();
            return;
        }
        if (shortcut && event.key.toLowerCase() === "h") {
            event.preventDefault();
            openToolSection("history-tools");
            return;
        }
        if (shortcut && event.key.toLowerCase() === "b") {
            event.preventDefault();
            setToolsOpen(!toolsSidebar.classList.contains("is-open"));
            return;
        }
        if (event.key === "Escape" && toolsSidebar.classList.contains("is-open")) {
            setToolsOpen(false);
            toolsToggle.focus();
        } else if (event.key === "Escape" && !textStylePanel.hidden) {
            textStylePanel.hidden = true;
            textStyleToggle.setAttribute("aria-expanded", "false");
            textStyleToggle.focus();
        }
    });

    document.addEventListener("click", (event) => {
        if (
            !compactToolsLayout()
            && textStyleMenu.contains(textStylePanel)
            && !textStyleMenu.contains(event.target)
        ) {
            textStylePanel.hidden = true;
            textStyleToggle.setAttribute("aria-expanded", "false");
        }
    });

    window.addEventListener("resize", () => {
        const isCompact = compactToolsLayout();
        if (isCompact !== wasCompactToolsLayout) {
            setToolsOpen(false);
            wasCompactToolsLayout = isCompact;
            syncTextStylePanel();
        }
        window.requestAnimationFrame(updateMobileTabFade);
    });

    passwordToggleButtons.forEach((button) => {
        button.addEventListener("click", () => togglePasswordVisibility(button));
    });

    themeButton.addEventListener("click", () => {
        openToolSection("appearance-tools");
    });

    copyUrlButton.addEventListener("click", () => {
        handleCopy(copyUrlButton, window.location.href);
    });

    copyTextButton.addEventListener("click", () => {
        if (!noteLocked) {
            handleCopy(copyTextButton, editor.value);
        }
    });

    slugSelect.addEventListener("change", async () => {
        const targetUrl = slugSelect.value;
        if (!targetUrl) {
            slugSelect.value = "";
            return;
        }
        if (targetUrl === window.location.pathname) {
            return;
        }

        slugSelect.disabled = true;
        window.clearTimeout(saveTimer);
        saveTimer = null;
        const saved = await saveIfChanged();
        if (!saved && editor.value !== lastSavedContent) {
            slugSelect.disabled = false;
            return;
        }
        window.location.assign(targetUrl);
    });

    unlockButton.addEventListener("click", async () => {
        const password = unlockPassword.value;
        unlockButton.disabled = true;
        lockMessage.textContent = "Checking...";
        try {
            const data = await fetchJson(unlockUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                },
                body: JSON.stringify({password}),
            });
            noteLocked = false;
            hasPassword = Boolean(data.has_password);
            noteTitle.value = data.title || "";
            lastSavedTitle = data.title || "";
            lastSavedTextColor = data.text_color;
            lastSavedTextWeight = String(data.text_weight);
            setTextStyle(lastSavedTextColor, lastSavedTextWeight, false);
            updatePageTitle();
            editor.value = data.content;
            lastSavedContent = data.content;
            showSaved(data.updated_at);
            renderAttachment(data.attachment);
            updateCounts();
            updateSearchMatches(true);
            updateReplaceMatches();
            rememberCurrentNote();
            updateLockState();
            loadHistory();
            scheduleRemoteRefresh(FAST_REFRESH_MS);
            editor.focus();
        } catch (error) {
            console.error(error);
            lockMessage.textContent = error.message;
        } finally {
            unlockButton.disabled = false;
        }
    });

    unlockPassword.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            unlockButton.click();
        }
    });

    setPasswordButton.addEventListener("click", async () => {
        const password = notePassword.value;
        if (!password.trim()) {
            setStatus("Enter password", "error");
            notePassword.focus();
            return;
        }
        setPasswordButton.disabled = true;
        try {
            await fetchJson(passwordUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                },
                body: JSON.stringify({password}),
            });
            hasPassword = true;
            notePassword.value = "";
            clearPasswordButton.hidden = false;
            setStatus("Lock set", "saved");
        } catch (error) {
            console.error(error);
            setStatus(error.message, "error");
        } finally {
            setPasswordButton.disabled = false;
        }
    });

    clearPasswordButton.addEventListener("click", async () => {
        clearPasswordButton.disabled = true;
        try {
            await fetchJson(passwordUrl, {
                method: "DELETE",
                headers: {"X-CSRFToken": csrfToken},
            });
            hasPassword = false;
            clearPasswordButton.hidden = true;
            setStatus("Lock removed", "saved");
        } catch (error) {
            console.error(error);
            setStatus(error.message, "error");
        } finally {
            clearPasswordButton.disabled = false;
        }
    });

    historySelect.addEventListener("change", () => {
        restoreHistoryButton.disabled = noteLocked || !historySelect.value;
        showHistoryDetails();
    });

    restoreHistoryButton.addEventListener("click", async () => {
        const historyId = historySelect.value;
        if (!historyId) {
            return;
        }
        if (!window.confirm("Restore this version? Your current content will be saved in history first.")) {
            return;
        }
        restoreHistoryButton.disabled = true;
        window.clearTimeout(saveTimer);
        saveTimer = null;
        const saved = await saveIfChanged();
        if (!saved && editor.value !== lastSavedContent) {
            restoreHistoryButton.disabled = false;
            return;
        }
        try {
            const data = await fetchJson(historyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                },
                body: JSON.stringify({history_id: historyId}),
            });
            editor.value = data.content;
            lastSavedContent = data.content;
            localStorage.removeItem(draftKey);
            showSaved(data.updated_at);
            updateCounts();
            updateSearchMatches(true);
            updateReplaceMatches();
            renderAttachment(data.attachment);
            renderHistory(data.history || []);
            setStatus("Restored", "saved");
        } catch (error) {
            console.error(error);
            setStatus(error.message, "error");
        } finally {
            restoreHistoryButton.disabled = !historySelect.value;
        }
    });

    fileInput.addEventListener("change", async () => {
        if (noteLocked) {
            fileInput.value = "";
            return;
        }
        const selectedFile = fileInput.files[0];
        if (!selectedFile) {
            return;
        }

        attachLabel.classList.add("is-busy");
        attachLabel.setAttribute("aria-busy", "true");
        fileStatus.textContent = "Uploading...";
        const formData = new FormData();
        formData.append("file", selectedFile);

        try {
            const response = await fetch(fileUrl, {
                method: "POST",
                headers: {"X-CSRFToken": csrfToken},
                credentials: "same-origin",
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Upload failed.");
            }
            renderAttachment(data.attachment);
        } catch (error) {
            console.error(error);
            fileStatus.textContent = error.message;
        } finally {
            fileInput.value = "";
            attachLabel.classList.remove("is-busy");
            attachLabel.removeAttribute("aria-busy");
        }
    });

    deleteFile.addEventListener("click", async () => {
        deleteFile.disabled = true;
        fileStatus.textContent = "Deleting...";
        try {
            const response = await fetch(fileUrl, {
                method: "DELETE",
                headers: {"X-CSRFToken": csrfToken},
                credentials: "same-origin",
            });
            if (!response.ok) {
                throw new Error("Delete failed.");
            }
            renderAttachment(null);
            fileStatus.textContent = "";
        } catch (error) {
            console.error(error);
            fileStatus.textContent = error.message;
        } finally {
            deleteFile.disabled = false;
        }
    });

    window.addEventListener("online", () => {
        if (pendingOfflineSave || hasUnsavedChanges()) {
            setStatus("Back online", "saving");
            saveIfChanged();
        }
    });

    window.addEventListener("offline", () => {
        if (hasUnsavedChanges()) {
            pendingOfflineSave = true;
            setStatus("Offline pending", "error");
        }
    });

    window.addEventListener("focus", async () => {
        markActivity();
        await loadRemoteChanges();
        scheduleRemoteRefresh();
    });

    window.addEventListener("pagehide", () => {
        if (noteLocked || !hasUnsavedChanges()) {
            return;
        }
        const savePayload = {};
        if (editor.value !== lastSavedContent) savePayload.content = editor.value;
        if (noteTitle.value.trim() !== lastSavedTitle) savePayload.title = noteTitle.value.trim();
        if (textColor !== lastSavedTextColor) savePayload.text_color = textColor;
        if (textWeight !== lastSavedTextWeight) savePayload.text_weight = Number(textWeight);
        fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrfToken,
            },
            credentials: "same-origin",
            keepalive: true,
            body: JSON.stringify(savePayload),
        }).catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            window.clearTimeout(pollTimer);
            pollTimer = null;
            return;
        }

        markActivity();
        loadRemoteChanges().finally(() => scheduleRemoteRefresh());
    });

    updateLockState();
    setToolsOpen(false);
    updateThemeControls();
    setTextStyle(textColor, textWeight, false);
    restoreLegacyTextStyle();
    syncTextStylePanel();
    updateMobileTabFade();
    updatePageTitle();
    updateCounts();
    renderSearchHighlights();
    rememberCurrentNote();
    restoreLocalDraft();
    if (!noteLocked) {
        loadRemoteChanges();
        loadHistory();
        scheduleRemoteRefresh();
    }
    window.setInterval(refreshSavedStatus, 5000);
})();
