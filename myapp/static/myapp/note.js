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
    const MAX_NOTE_LINES = 2000;

    let noteLocked = editor.dataset.locked === "true";
    let hasPassword = editor.dataset.hasPassword === "true";
    let lastSavedContent = editor.value;
    let lastSavedAt = editor.dataset.updatedAt ? new Date(editor.dataset.updatedAt) : null;
    let saveInProgress = false;
    let activeSavePromise = null;
    let pollInProgress = false;
    let saveTimer = null;
    let pollTimer = null;
    let pendingOfflineSave = false;
    let lastActivityAt = Date.now();
    let searchMatches = [];
    let activeMatchIndex = -1;

    function setStatus(label, state) {
        status.textContent = label;
        status.dataset.state = state;
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

    function renderSearchHighlights() {
        searchHighlights.replaceChildren();

        if (!searchInput.value || !searchMatches.length) {
            searchHighlights.textContent = editor.value;
            syncHighlightScroll();
            return;
        }

        let cursor = 0;
        searchMatches.forEach((start, index) => {
            searchHighlights.append(
                document.createTextNode(editor.value.slice(cursor, start)),
            );

            const mark = document.createElement("mark");
            mark.textContent = editor.value.slice(
                start,
                start + searchInput.value.length,
            );
            if (index === activeMatchIndex) {
                mark.classList.add("is-active");
            }
            searchHighlights.append(mark);
            cursor = start + searchInput.value.length;
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

        if (noteLocked || editor.value === lastSavedContent) {
            return;
        }

        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            saveIfChanged();
        }, SAVE_DELAY_MS);
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
        if (editor.value === lastSavedContent) {
            return true;
        }

        const contentToSave = editor.value;
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
                    body: JSON.stringify({content: contentToSave}),
                });

                lastSavedContent = contentToSave;
                renderAttachment(data.attachment);
                showSaved(data.updated_at);
                scheduleRemoteRefresh(FAST_REFRESH_MS);
                loadHistory();
                if (editor.value !== lastSavedContent) {
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
                if (editor.value !== lastSavedContent && !pendingOfflineSave) {
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
            || editor.value !== lastSavedContent
        ) {
            return;
        }

        pollInProgress = true;
        try {
            const data = await fetchJson(apiUrl, {cache: "no-store"});
            if (data.content !== lastSavedContent) {
                editor.value = data.content;
                lastSavedContent = data.content;
                lastSavedAt = new Date(data.updated_at);
                lastActivityAt = Date.now();
                updateCounts();
                updateSearchMatches();
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
        if (editor.value === lastSavedContent) {
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

    editor.addEventListener("scroll", syncHighlightScroll);

    searchInput.addEventListener("input", () => {
        updateSearchMatches(true);
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

    passwordToggleButtons.forEach((button) => {
        button.addEventListener("click", () => togglePasswordVisibility(button));
    });

    themeButton.addEventListener("click", () => {
        const themes = ["dark", "light", "telegram"];
        const currentIndex = themes.indexOf(root.dataset.theme);
        const theme = themes[(currentIndex + 1) % themes.length];
        root.dataset.theme = theme;
        localStorage.setItem("note-theme", theme);
        themeButton.title = `Switch theme (${theme})`;
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
            editor.value = data.content;
            lastSavedContent = data.content;
            showSaved(data.updated_at);
            renderAttachment(data.attachment);
            updateCounts();
            updateSearchMatches(true);
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
    });

    restoreHistoryButton.addEventListener("click", async () => {
        const historyId = historySelect.value;
        if (!historyId) {
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
            showSaved(data.updated_at);
            updateCounts();
            updateSearchMatches(true);
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
        if (pendingOfflineSave || editor.value !== lastSavedContent) {
            setStatus("Back online", "saving");
            saveIfChanged();
        }
    });

    window.addEventListener("offline", () => {
        if (editor.value !== lastSavedContent) {
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
        if (noteLocked || editor.value === lastSavedContent) {
            return;
        }
        fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrfToken,
            },
            credentials: "same-origin",
            keepalive: true,
            body: JSON.stringify({content: editor.value}),
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
    updateCounts();
    renderSearchHighlights();
    if (!noteLocked) {
        loadRemoteChanges();
        loadHistory();
        scheduleRemoteRefresh();
    }
    window.setInterval(refreshSavedStatus, 5000);
})();
