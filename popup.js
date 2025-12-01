// Get current window ID
let currentWindowId = null;

// Get references to background page functions
const backgroundPage = browser.extension.getBackgroundPage();

/**
 * Initialize the popup
 */
async function initialize() {
  // Get current window
  const currentWindow = await browser.windows.getCurrent();
  currentWindowId = currentWindow.id;

  // Update UI based on sync status
  await updateUI();

  // Load bookmark folders into dropdown
  await loadBookmarkFolders();

  // Set up event listeners
  setupEventListeners();
}

/**
 * Update the UI based on current sync status
 */
async function updateUI() {
  const mappings = backgroundPage.getWindowMappings();
  const mapping = mappings[currentWindowId];

  const syncedStatus = document.getElementById('synced-status');
  const unsyncedStatus = document.getElementById('unsynced-status');
  const actionsSection = document.getElementById('actions');

  if (mapping) {
    // Window is synced
    syncedStatus.classList.remove('hidden');
    unsyncedStatus.classList.add('hidden');
    actionsSection.classList.add('hidden');

    document.getElementById('folder-name').textContent = mapping.folderTitle;
  } else {
    // Window is not synced
    syncedStatus.classList.add('hidden');
    unsyncedStatus.classList.remove('hidden');
    actionsSection.classList.remove('hidden');
  }
}

/**
 * Load all bookmark folders into the dropdowns
 */
async function loadBookmarkFolders() {
  const syncSelect = document.getElementById('folder-select');
  const openSelect = document.getElementById('open-folder-select');

  // Get all bookmark folders
  const bookmarkTree = await browser.bookmarks.getTree();

  // Get last used timestamps
  const folderLastUsed = backgroundPage.getFolderLastUsed();

  // Clear existing options (except the first placeholder) from both dropdowns
  while (syncSelect.options.length > 1) {
    syncSelect.remove(1);
  }
  while (openSelect.options.length > 1) {
    openSelect.remove(1);
  }

  // Firefox built-in root folder IDs to exclude
  const rootFolderIds = new Set([
    'root________',  // Root
    'menu________',  // Bookmarks Menu
    'toolbar_____',  // Bookmarks Toolbar
    'unfiled_____',  // Other Bookmarks
    'mobile______'   // Mobile Bookmarks
  ]);

  // Collect all folders with their metadata
  const allFolders = [];

  // Recursively traverse bookmark tree to find folders
  function traverseTree(nodes, depth = 0) {
    for (const node of nodes) {
      if (node.type === 'folder' || (!node.url && node.children)) {
        // Skip root folders with special IDs
        if (!rootFolderIds.has(node.id) && node.title) {
          allFolders.push({
            id: node.id,
            title: node.title,
            depth: depth,
            lastUsed: folderLastUsed[node.id] || 0
          });
        }

        // Recursively process children
        if (node.children) {
          traverseTree(node.children, depth + 1);
        }
      }
    }
  }

  traverseTree(bookmarkTree);

  // Sort folders by last used (most recent first)
  allFolders.sort((a, b) => b.lastUsed - a.lastUsed);

  // Add sorted folders to both dropdowns
  for (const folder of allFolders) {
    // Add to sync dropdown
    const syncOption = document.createElement('option');
    syncOption.value = folder.id;
    syncOption.textContent = '  '.repeat(folder.depth) + folder.title;
    syncSelect.appendChild(syncOption);

    // Add to open dropdown
    const openOption = document.createElement('option');
    openOption.value = folder.id;
    openOption.textContent = '  '.repeat(folder.depth) + folder.title;
    openSelect.appendChild(openOption);
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Create new folder button
  document.getElementById('create-folder-btn').addEventListener('click', async () => {
    const folderName = document.getElementById('new-folder-name').value.trim();

    if (!folderName) {
      alert('Please enter a folder name');
      return;
    }

    try {
      await backgroundPage.createFolderForWindow(currentWindowId, folderName);
      await updateUI();
      document.getElementById('new-folder-name').value = '';
    } catch (error) {
      console.error('Error creating folder:', error);
      alert('Failed to create folder: ' + error.message);
    }
  });

  // Sync with existing folder button
  document.getElementById('sync-folder-btn').addEventListener('click', async () => {
    const select = document.getElementById('folder-select');
    const folderId = select.value;
    const folderTitle = select.options[select.selectedIndex].text.trim();

    if (!folderId) {
      alert('Please select a folder');
      return;
    }

    try {
      await backgroundPage.associateWindowWithFolder(currentWindowId, folderId, folderTitle);
      await updateUI();
    } catch (error) {
      console.error('Error syncing folder:', error);
      alert('Failed to sync folder: ' + error.message);
    }
  });

  // Unsync button
  document.getElementById('unsync-btn').addEventListener('click', async () => {
    if (confirm('Unsync this window? The bookmark folder will be kept.')) {
      try {
        await backgroundPage.disassociateWindow(currentWindowId);
        await updateUI();
        await loadBookmarkFolders(); // Reload folder list
      } catch (error) {
        console.error('Error unsyncing window:', error);
        alert('Failed to unsync window: ' + error.message);
      }
    }
  });

  // Enable/disable sync button based on folder selection
  document.getElementById('folder-select').addEventListener('change', (e) => {
    const syncBtn = document.getElementById('sync-folder-btn');
    syncBtn.disabled = !e.target.value;
  });

  // Allow Enter key to create folder
  document.getElementById('new-folder-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('create-folder-btn').click();
    }
  });

  // Open folder as new window button
  document.getElementById('open-folder-btn').addEventListener('click', async () => {
    const select = document.getElementById('open-folder-select');
    const folderId = select.value;
    const folderTitle = select.options[select.selectedIndex].text.trim();

    if (!folderId) {
      alert('Please select a folder');
      return;
    }

    try {
      // Get the folder contents to check bookmark count
      const bookmarkTree = await browser.bookmarks.getSubTree(folderId);
      const bookmarks = bookmarkTree[0].children || [];

      // Count only direct bookmark children (not nested folders)
      const urlBookmarks = bookmarks.filter(b => b.url && !b.url.startsWith('about:') && !b.url.startsWith('moz-extension:'));

      // Warn if opening many tabs
      if (urlBookmarks.length > 20) {
        const confirmed = confirm(
          `This folder contains ${urlBookmarks.length} bookmarks. Opening this will create ${urlBookmarks.length} tabs.\n\nAre you sure you want to continue?`
        );
        if (!confirmed) {
          return;
        }
      }

      await backgroundPage.openFolderAsNewWindow(folderId, folderTitle);
      // Close the popup after opening the new window
      window.close();
    } catch (error) {
      console.error('Error opening folder:', error);
      alert('Failed to open folder: ' + error.message);
    }
  });

  // Enable/disable open button based on folder selection
  document.getElementById('open-folder-select').addEventListener('change', (e) => {
    const openBtn = document.getElementById('open-folder-btn');
    openBtn.disabled = !e.target.value;
  });
}

// Initialize when popup loads
initialize();
