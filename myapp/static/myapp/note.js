(() => {
    const root = document.documentElement;
    const editor = document.getElementById("note-editor");
    const searchHighlights = document.getElementById("search-highlights");
    const status = document.getElementById("save-status");
    const themeButton = document.getElementById("theme-toggle");
    const searchInput = document.getElementById("note-search");
    const searchCount = document.getElementById("search-count");
    const copyUrlButton = document.getElementById("copy-url");
    const copyTextButton = document.getElementById("copy-text");
    const attachLabel = document.getElementById("attach-label");
    const fileInput = document.getElementById("file-input");
    const fileActions = document.getElementById("file-actions");
    const fileName = document.getElementById("file-name");
    const downloadFile = document.getElementById("download-file");
    const deleteFile = document.getElementById("delete-file");
    const fileStatus = document.getElementById("file-status");
    const wordCount = document.getElementById("word-count");
    const characterCount = document.getElementById("character-count");
    const csrfToken = document.querySelector("[name=csrfmiddlewaretoken]").value;
    const apiUrl = editor.dataset.apiUrl;
    const fileUrl = editor.dataset.fileUrl;
    const SAVE_DELAY_MS = 2000;
    const FAST_REFRESH_MS = 3000;
    const ACTIVE_REFRESH_MS = 10000;
    const WARM_REFRESH_MS = 30000;
    const IDLE_REFRESH_MS = 60000;
    const LONG_IDLE_REFRESH_MS = 5 * 60 * 1000;

    let lastSavedContent = editor.value;
    let saveInProgress = false;
    let pollInProgress = false;
    let saveTimer = null;
    let pollTimer = null;
    let lastActivityAt = Date.now();
    let searchMatches = [];
    let activeMatchIndex = -1;

    function setStatus(label, state) {
        status.textContent = label;
        status.dataset.state = state;
    }

    function updateCounts() {
        const content = editor.value;
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        wordCount.textContent = words;
        characterCount.textContent = content.length;
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

        if (editor.value === lastSavedContent) {
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

        if (document.hidden) {
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

    editor.addEventListener("input", () => {
        markActivity();
        updateCounts();
        updateSearchMatches();
        if (editor.value === lastSavedContent) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
            setStatus("Saved", "saved");
        } else {
            setStatus("Typing...", "typing");
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

    async function saveIfChanged() {
        if (saveInProgress || editor.value === lastSavedContent) {
            return;
        }

        const contentToSave = editor.value;
        saveInProgress = true;
        setStatus("Saving...", "saving");

        try {
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken,
                },
                credentials: "same-origin",
                body: JSON.stringify({ content: contentToSave }),
            });

            if (!response.ok) {
                throw new Error(`Save failed with status ${response.status}`);
            }

            const data = await response.json();
            lastSavedContent = contentToSave;
            renderAttachment(data.attachment);
            scheduleRemoteRefresh(FAST_REFRESH_MS);
            setStatus(
                editor.value === lastSavedContent ? "Saved" : "Typing...",
                editor.value === lastSavedContent ? "saved" : "typing",
            );
        } catch (error) {
            console.error(error);
            setStatus("Error", "error");
        } finally {
            saveInProgress = false;
            if (editor.value !== lastSavedContent) {
                scheduleSave();
            }
        }
    }

    async function loadRemoteChanges() {
        if (
            document.hidden
            ||
            pollInProgress
            || saveInProgress
            || editor.value !== lastSavedContent
        ) {
            return;
        }

        pollInProgress = true;
        try {
            const response = await fetch(apiUrl, {
                credentials: "same-origin",
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error(`Refresh failed with status ${response.status}`);
            }

            const data = await response.json();
            if (data.content !== lastSavedContent) {
                editor.value = data.content;
                lastSavedContent = data.content;
                lastActivityAt = Date.now();
                updateCounts();
                updateSearchMatches();
                setStatus("Updated", "saved");
            }
            renderAttachment(data.attachment);
        } catch (error) {
            console.error(error);
        } finally {
            pollInProgress = false;
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

    themeButton.addEventListener("click", () => {
        const theme = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = theme;
        localStorage.setItem("note-theme", theme);
    });

    copyUrlButton.addEventListener("click", () => {
        handleCopy(copyUrlButton, window.location.href);
    });

    copyTextButton.addEventListener("click", () => {
        handleCopy(copyTextButton, editor.value);
    });

    fileInput.addEventListener("change", async () => {
        const selectedFile = fileInput.files[0];
        if (!selectedFile) {
            return;
        }

        attachLabel.classList.add("is-busy");
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

    window.addEventListener("focus", async () => {
        markActivity();
        await loadRemoteChanges();
        scheduleRemoteRefresh();
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

    updateCounts();
    renderSearchHighlights();
    loadRemoteChanges();
    scheduleRemoteRefresh();
})();
