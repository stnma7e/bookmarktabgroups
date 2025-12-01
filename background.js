// Storage keys
const STORAGE_KEY = 'windowFolderMappings';
const PINNED_TABS_KEY = 'pinnedTabsByFolder';
const FOLDER_LAST_USED_KEY = 'folderLastUsed';

// In-memory cache of window -> folder mappings
// Format: { windowId: { folderId: string, folderTitle: string } }
let windowMappings = {};

// In-memory cache of pinned tabs per folder
// Format: { folderId: Set<url> }
let pinnedTabsByFolder = {};

// Track last used timestamp for each folder
// Format: { folderId: timestamp }
let folderLastUsed = {};

// Track if we're currently syncing to prevent infinite loops
let isSyncing = false;

// Track windows that need to be synced after current sync completes
let pendingSyncs = new Set();

/**
 * Initialize the extension
 */
async function initialize() {
  // Load existing mappings from storage
  const data = await browser.storage.local.get([STORAGE_KEY, PINNED_TABS_KEY, FOLDER_LAST_USED_KEY]);
  windowMappings = data[STORAGE_KEY] || {};

  // Load pinned tabs (convert arrays back to Sets)
  const pinnedData = data[PINNED_TABS_KEY] || {};
  pinnedTabsByFolder = {};
  for (const folderId in pinnedData) {
    pinnedTabsByFolder[folderId] = new Set(pinnedData[folderId]);
  }

  // Load folder last used timestamps
  folderLastUsed = data[FOLDER_LAST_USED_KEY] || {};

  // Clean up mappings for windows that no longer exist
  const windows = await browser.windows.getAll();
  const validWindowIds = new Set(windows.map(w => w.id));

  for (const windowId in windowMappings) {
    if (!validWindowIds.has(parseInt(windowId))) {
      delete windowMappings[windowId];
    }
  }

  await saveWindowMappings();

  console.log('Tab Group Bookmarks initialized');
  console.log('Window mappings:', windowMappings);
  console.log('Pinned tabs by folder:', pinnedTabsByFolder);
}

/**
 * Save window mappings to storage
 */
async function saveWindowMappings() {
  await browser.storage.local.set({ [STORAGE_KEY]: windowMappings });
}

/**
 * Save pinned tabs to storage
 */
async function savePinnedTabs() {
  // Convert Sets to arrays for storage
  const pinnedData = {};
  for (const folderId in pinnedTabsByFolder) {
    pinnedData[folderId] = Array.from(pinnedTabsByFolder[folderId]);
  }
  await browser.storage.local.set({ [PINNED_TABS_KEY]: pinnedData });
}

/**
 * Update last used timestamp for a folder
 */
async function updateFolderLastUsed(folderId) {
  folderLastUsed[folderId] = Date.now();
  await browser.storage.local.set({ [FOLDER_LAST_USED_KEY]: folderLastUsed });
  console.log('Updated last used for folder', folderId);
}

/**
 * Associate a window with a bookmark folder
 */
async function associateWindowWithFolder(windowId, folderId, folderTitle) {
  windowMappings[windowId] = { folderId, folderTitle };
  await saveWindowMappings();

  // Update last used timestamp
  await updateFolderLastUsed(folderId);

  // Initial sync: populate bookmarks with current tabs
  await syncTabsToBookmarks(windowId);
}

/**
 * Create a new bookmark folder and associate it with a window
 */
async function createFolderForWindow(windowId, folderTitle) {
  const folder = await browser.bookmarks.create({
    title: folderTitle,
    type: 'folder'
  });

  await associateWindowWithFolder(windowId, folder.id, folderTitle);
  return folder;
}

/**
 * Disassociate a window from its bookmark folder
 */
async function disassociateWindow(windowId) {
  delete windowMappings[windowId];
  await saveWindowMappings();
}

/**
 * Open a bookmark folder as a new window with syncing enabled
 */
async function openFolderAsNewWindow(folderId, folderTitle) {
  // Get all bookmarks in the folder
  const bookmarkTree = await browser.bookmarks.getSubTree(folderId);
  const bookmarks = bookmarkTree[0].children || [];

  // Filter out non-URL bookmarks (folders)
  const urlBookmarks = bookmarks.filter(b => b.url && !b.url.startsWith('about:') && !b.url.startsWith('moz-extension:'));

  if (urlBookmarks.length === 0) {
    // Create empty window
    const newWindow = await browser.windows.create();
    windowMappings[newWindow.id] = { folderId, folderTitle };
    await saveWindowMappings();
    await updateFolderLastUsed(folderId);
    return newWindow;
  }

  // Get pinned URLs for this folder
  const pinnedUrls = pinnedTabsByFolder[folderId] || new Set();

  console.log('Opening folder', folderId, 'with pinned tabs:', Array.from(pinnedUrls));

  // Create window (it will have one blank tab initially)
  const newWindow = await browser.windows.create();

  // Get the initial blank tab ID before creating other tabs
  const initialTabs = await browser.tabs.query({ windowId: newWindow.id });
  const initialBlankTabId = initialTabs[0]?.id;

  // Associate the window with the folder immediately
  windowMappings[newWindow.id] = { folderId, folderTitle };
  await saveWindowMappings();

  // Update last used timestamp
  await updateFolderLastUsed(folderId);

  // Create all bookmarked tabs with their pinned status
  // Firefox will automatically order pinned tabs at the beginning
  for (const bookmark of urlBookmarks) {
    const shouldBePinned = pinnedUrls.has(bookmark.url);
    console.log('Creating tab:', bookmark.url, 'pinned:', shouldBePinned);
    await browser.tabs.create({
      windowId: newWindow.id,
      url: bookmark.url,
      active: false,
      pinned: shouldBePinned
    });
  }

  // Remove the initial blank tab by ID
  if (initialBlankTabId) {
    await browser.tabs.remove(initialBlankTabId);
  }

  return newWindow;
}

/**
 * Sync all tabs in a window to its bookmark folder
 */
async function syncTabsToBookmarks(windowId) {
  const mapping = windowMappings[windowId];
  if (!mapping) return;

  // If already syncing, queue this window for later
  if (isSyncing) {
    console.log('Sync already in progress, queuing window', windowId);
    pendingSyncs.add(windowId);
    return;
  }

  isSyncing = true;
  console.log('=== syncTabsToBookmarks START for window', windowId, '===');

  try {
    // Get all tabs in the window
    const tabs = await browser.tabs.query({ windowId });
    console.log('Found', tabs.length, 'tabs');

    // Get all bookmarks in the folder
    const bookmarkTree = await browser.bookmarks.getSubTree(mapping.folderId);
    const existingBookmarks = bookmarkTree[0].children || [];

    // Create a map of URL -> bookmark for quick lookup
    const bookmarksByUrl = new Map();
    existingBookmarks.forEach(bookmark => {
      if (bookmark.url) {
        bookmarksByUrl.set(bookmark.url, bookmark);
      }
    });

    // Track which bookmarks we've seen (to identify ones to delete)
    const seenBookmarkIds = new Set();

    // Track pinned tabs for this folder
    const pinnedUrls = new Set();

    // Sync tabs to bookmarks
    let bookmarkIndex = 0;
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];

      // Skip about: and moz-extension: URLs
      if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) {
        continue;
      }

      console.log('Processing tab:', tab.url, 'pinned:', tab.pinned);

      // Track if this tab is pinned
      if (tab.pinned) {
        console.log('Adding to pinned URLs:', tab.url);
        pinnedUrls.add(tab.url);
      }

      const existingBookmark = bookmarksByUrl.get(tab.url);

      if (existingBookmark) {
        // Bookmark exists, mark it as seen
        seenBookmarkIds.add(existingBookmark.id);

        // Update title if different
        if (existingBookmark.title !== tab.title) {
          await browser.bookmarks.update(existingBookmark.id, { title: tab.title });
        }

        // Update position if different
        if (existingBookmark.index !== bookmarkIndex) {
          await browser.bookmarks.move(existingBookmark.id, { index: bookmarkIndex });
        }
      } else {
        // Create new bookmark
        const newBookmark = await browser.bookmarks.create({
          parentId: mapping.folderId,
          title: tab.title,
          url: tab.url,
          index: bookmarkIndex
        });
        seenBookmarkIds.add(newBookmark.id);
      }

      bookmarkIndex++;
    }

    // Remove bookmarks that don't have corresponding tabs
    for (const bookmark of existingBookmarks) {
      if (!seenBookmarkIds.has(bookmark.id)) {
        await browser.bookmarks.remove(bookmark.id);
      }
    }

    // Save pinned tab URLs for this folder
    pinnedTabsByFolder[mapping.folderId] = pinnedUrls;
    console.log('Pinned URLs for this sync:', Array.from(pinnedUrls));
    await savePinnedTabs();

    console.log('=== syncTabsToBookmarks END - Saved pinned tabs for folder', mapping.folderId, ':', Array.from(pinnedUrls), '===');
  } finally {
    isSyncing = false;

    // Process any pending syncs
    if (pendingSyncs.size > 0) {
      console.log('Processing pending syncs:', Array.from(pendingSyncs));
      const nextWindowId = pendingSyncs.values().next().value;
      pendingSyncs.delete(nextWindowId);
      // Run the next sync asynchronously (don't await to avoid blocking)
      syncTabsToBookmarks(nextWindowId);
    }
  }
}

/**
 * Sync bookmarks in a folder to tabs in the window
 */
async function syncBookmarksToTabs(folderId) {
  // Find the window associated with this folder
  const windowId = Object.keys(windowMappings).find(
    wId => windowMappings[wId].folderId === folderId
  );

  if (!windowId) return;

  // If already syncing, queue this window for later
  if (isSyncing) {
    console.log('Sync already in progress, queuing window', windowId, 'for bookmark sync');
    pendingSyncs.add(parseInt(windowId));
    return;
  }

  isSyncing = true;

  try {
    // Get all bookmarks in the folder
    const bookmarkTree = await browser.bookmarks.getSubTree(folderId);
    const bookmarks = bookmarkTree[0].children || [];

    // Get all tabs in the window
    const tabs = await browser.tabs.query({ windowId: parseInt(windowId) });

    // Get pinned URLs for this folder
    const pinnedUrls = pinnedTabsByFolder[folderId] || new Set();

    // Create a map of URL -> tab for quick lookup
    const tabsByUrl = new Map();
    tabs.forEach(tab => {
      if (tab.url && !tab.url.startsWith('about:') && !tab.url.startsWith('moz-extension:')) {
        tabsByUrl.set(tab.url, tab);
      }
    });

    // Track which tabs we've seen (to identify ones to close)
    const seenTabIds = new Set();

    // Sync bookmarks to tabs
    for (let i = 0; i < bookmarks.length; i++) {
      const bookmark = bookmarks[i];

      // Skip folders
      if (!bookmark.url) continue;

      const shouldBePinned = pinnedUrls.has(bookmark.url);
      const existingTab = tabsByUrl.get(bookmark.url);

      if (existingTab) {
        // Tab exists, mark it as seen
        seenTabIds.add(existingTab.id);

        // Update pinned status if different
        if (existingTab.pinned !== shouldBePinned) {
          await browser.tabs.update(existingTab.id, { pinned: shouldBePinned });
        }

        // Update position if different
        if (existingTab.index !== i) {
          await browser.tabs.move(existingTab.id, { windowId: parseInt(windowId), index: i });
        }
      } else {
        // Create new tab
        const newTab = await browser.tabs.create({
          windowId: parseInt(windowId),
          url: bookmark.url,
          active: false,
          pinned: shouldBePinned,
          index: i
        });
        seenTabIds.add(newTab.id);
      }
    }

    // Close tabs that don't have corresponding bookmarks
    for (const tab of tabs) {
      if (!seenTabIds.has(tab.id) && !tab.url.startsWith('about:') && !tab.url.startsWith('moz-extension:')) {
        await browser.tabs.remove(tab.id);
      }
    }
  } finally {
    isSyncing = false;

    // Process any pending syncs
    if (pendingSyncs.size > 0) {
      console.log('Processing pending syncs:', Array.from(pendingSyncs));
      const nextWindowId = pendingSyncs.values().next().value;
      pendingSyncs.delete(nextWindowId);
      // Run the next sync asynchronously (don't await to avoid blocking)
      syncTabsToBookmarks(nextWindowId);
    }
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

// Tab created
browser.tabs.onCreated.addListener(async (tab) => {
  if (!windowMappings[tab.windowId]) return;
  await syncTabsToBookmarks(tab.windowId);
});

// Tab removed
browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  console.log('Tab removed:', tabId, 'windowId:', removeInfo.windowId, 'isWindowClosing:', removeInfo.isWindowClosing);

  if (!windowMappings[removeInfo.windowId]) {
    console.log('Window not synced, ignoring');
    return;
  }
  if (removeInfo.isWindowClosing) {
    console.log('Window closing, ignoring');
    return;
  }

  console.log('Syncing tabs to bookmarks due to tab removal');
  await syncTabsToBookmarks(removeInfo.windowId);
});

// Tab updated (URL, title, or pinned status change)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  console.log('Tab updated:', tabId, 'changeInfo:', changeInfo, 'windowId:', tab.windowId);

  if (!windowMappings[tab.windowId]) {
    console.log('Window not synced, ignoring');
    return;
  }

  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined) {
    console.log('Syncing tabs to bookmarks due to tab update');
    await syncTabsToBookmarks(tab.windowId);
  }
});

// Tab moved
browser.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  if (!windowMappings[moveInfo.windowId]) return;
  await syncTabsToBookmarks(moveInfo.windowId);
});

// Tab attached to different window
browser.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  if (!windowMappings[attachInfo.newWindowId]) return;
  await syncTabsToBookmarks(attachInfo.newWindowId);
});

// Tab detached from window
browser.tabs.onDetached.addListener(async (tabId, detachInfo) => {
  if (!windowMappings[detachInfo.oldWindowId]) return;
  await syncTabsToBookmarks(detachInfo.oldWindowId);
});

// Window removed - we keep the bookmarks as requested
browser.windows.onRemoved.addListener(async (windowId) => {
  if (windowMappings[windowId]) {
    // Just remove the mapping, keep the bookmarks
    delete windowMappings[windowId];
    await saveWindowMappings();
  }
});

// Bookmark created
browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (!bookmark.url) return; // Skip folders

  // Find if this bookmark is in a tracked folder
  const parentFolderId = bookmark.parentId;
  const windowId = Object.keys(windowMappings).find(
    wId => windowMappings[wId].folderId === parentFolderId
  );

  if (windowId) {
    await syncBookmarksToTabs(parentFolderId);
  }
});

// Bookmark removed
browser.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  // Find if this bookmark was in a tracked folder
  const windowId = Object.keys(windowMappings).find(
    wId => windowMappings[wId].folderId === removeInfo.parentId
  );

  if (windowId) {
    await syncBookmarksToTabs(removeInfo.parentId);
  }
});

// Bookmark changed (title or URL)
browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
  // Get the bookmark to find its parent
  const bookmarks = await browser.bookmarks.get(id);
  if (bookmarks.length === 0) return;

  const bookmark = bookmarks[0];
  const windowId = Object.keys(windowMappings).find(
    wId => windowMappings[wId].folderId === bookmark.parentId
  );

  if (windowId) {
    await syncBookmarksToTabs(bookmark.parentId);
  }
});

// Bookmark moved
browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  // Check if moved within a tracked folder
  const windowId = Object.keys(windowMappings).find(
    wId => windowMappings[wId].folderId === moveInfo.parentId
  );

  if (windowId) {
    await syncBookmarksToTabs(moveInfo.parentId);
  }

  // Also check old parent in case it was moved out
  const oldWindowId = Object.keys(windowMappings).find(
    wId => windowMappings[wId].folderId === moveInfo.oldParentId
  );

  if (oldWindowId) {
    await syncBookmarksToTabs(moveInfo.oldParentId);
  }
});

// Initialize on startup
initialize();

// Export functions for use by popup
window.associateWindowWithFolder = associateWindowWithFolder;
window.createFolderForWindow = createFolderForWindow;
window.disassociateWindow = disassociateWindow;
window.openFolderAsNewWindow = openFolderAsNewWindow;
window.getWindowMappings = () => windowMappings;
window.getFolderLastUsed = () => folderLastUsed;
