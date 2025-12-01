# Tab Group Bookmarks

A Firefox extension that syncs browser windows with bookmark folders. Each window acts as a tab group, with automatic two-way synchronization between tabs and bookmarks.

## Features

- **Window-based tab groups**: Each browser window represents a separate tab group
- **Two-way sync**: Changes to tabs automatically update bookmarks, and vice versa
- **Persistent storage**: Tab groups are stored as bookmark folders, surviving browser restarts
- **Flexible setup**: Create new bookmark folders or use existing ones
- **Automatic cleanup**: Window-to-folder mappings are cleaned up when windows close (bookmarks are preserved)

## Installation

### Development Installation

1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on"
5. Navigate to the extension directory and select `manifest.json`

### Permanent Installation

To install the extension permanently, you'll need to:
1. Sign the extension through [addons.mozilla.org](https://addons.mozilla.org)
2. Or use [Firefox Developer Edition](https://www.mozilla.org/en-US/firefox/developer/) or [Firefox Nightly](https://www.mozilla.org/en-US/firefox/nightly/) with `xpinstall.signatures.required` set to `false` in `about:config`

## Usage

### Opening a Folder as a New Window

The quickest way to restore a saved tab group:

1. Click the Tab Group Bookmarks icon in your browser toolbar
2. In the "Open Folder as New Window" section, select a bookmark folder from the dropdown
3. Click "Open"
4. A new window will open with all tabs from that folder, automatically synced

### Setting Up Sync for an Existing Window

To sync the current window with a bookmark folder:

1. Click the Tab Group Bookmarks icon in your browser toolbar
2. In the "Sync This Window" section, choose one of two options:
   - **Create New Folder**: Enter a name and click "Create & Sync" to create a new bookmark folder
   - **Use Existing Folder**: Select an existing bookmark folder from the dropdown and click "Sync"
3. The window is now synced! All changes to tabs or bookmarks will be automatically synchronized

### How Sync Works

**When you add/remove/move tabs in a synced window:**
- New tabs are added as bookmarks in the associated folder
- Closed tabs have their bookmarks removed
- Tab reordering updates bookmark order
- Tab title changes update bookmark titles

**When you add/remove/move bookmarks in a synced folder:**
- New bookmarks open as tabs in the associated window
- Deleted bookmarks close their corresponding tabs
- Bookmark reordering changes tab order
- URL changes update the tab

### Unsyncing a Window

1. Click the Tab Group Bookmarks icon
2. Click "Unsync Window"
3. The bookmark folder is preserved, but changes will no longer sync

### Restoring a Saved Tab Group

Simply use the "Open Folder as New Window" feature (see above). This will create a new window with all tabs from your saved bookmark folder and automatically keep them in sync.

## Technical Details

### How It Works

- The extension uses Firefox's `bookmarks`, `tabs`, and `storage` APIs
- Window-to-folder mappings are stored in local storage
- Event listeners monitor both tab and bookmark changes
- A sync guard prevents infinite loops during bidirectional sync
- Special URLs (`about:*`, `moz-extension:*`) are ignored during sync

### Data Storage

Window-to-folder mappings are stored locally using `browser.storage.local`. The storage format is:

```javascript
{
  "windowFolderMappings": {
    "<windowId>": {
      "folderId": "<bookmarkFolderId>",
      "folderTitle": "<folderName>"
    }
  }
}
```

### Limitations

- Special Firefox URLs (about:*, moz-extension:*) cannot be bookmarked and are skipped during sync
- Duplicate URLs: If you have multiple tabs with the same URL, only one bookmark will be created
- The extension requires the `bookmarks`, `tabs`, and `storage` permissions

## Development

### Project Structure

```
tab-group-bookmarks/
├── manifest.json       # Extension configuration
├── background.js       # Core sync logic and event handlers
├── popup.html          # UI for managing window-folder associations
├── popup.js            # UI logic
├── popup.css           # UI styling
├── icons/              # Extension icons
└── README.md           # Documentation
```

### Key Functions

**background.js:**
- `associateWindowWithFolder(windowId, folderId, folderTitle)`: Link a window to a folder
- `createFolderForWindow(windowId, folderTitle)`: Create a new folder and associate it
- `disassociateWindow(windowId)`: Remove the association
- `syncTabsToBookmarks(windowId)`: One-way sync from tabs to bookmarks
- `syncBookmarksToTabs(folderId)`: One-way sync from bookmarks to tabs

## Contributing

Contributions are welcome! Feel free to:
- Report bugs by creating an issue
- Suggest features or improvements
- Submit pull requests

## License

This project is open source. Feel free to use, modify, and distribute as needed.

## Troubleshooting

**Tabs/bookmarks aren't syncing:**
- Check that the window is properly synced (click the extension icon to verify)
- Try unsyncing and re-syncing the window
- Check the browser console for errors

**Bookmarks folder doesn't appear in the dropdown:**
- The extension only shows bookmark folders, not individual bookmarks
- Try refreshing the popup by closing and reopening it

**Extension won't load:**
- Verify all files are present in the extension directory
- Check `about:debugging` for error messages
- Ensure you have the latest version of Firefox

## Future Enhancements

Potential features for future versions:
- Custom icon selection for tab groups
- Keyboard shortcuts for common actions
- Import/export of window-folder mappings
- Tab group templates
- Automatic window creation when opening a synced folder
