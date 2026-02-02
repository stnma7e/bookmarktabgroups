This firefox extension has a couple of bugs related
  to concurrency. Can you help fix them. The bugs are
  listed in BUGS.md. The main idea is that sometimes
  when you have a tab open, the extension opens a copy
  of that tab. I imagine this happens when something
  about the tab changes subtly from the saved copy
  (maybe a different URL) and the extension assumes
  that a new tab has been opened and that the old tab
  needs to be re-opened. I'm not sure. This is not the
  correct behavior anyways. The extension should treat
  an open window as the source of truth for bookmarks
  and not open new tabs based on the bookmark state.
  The only time tabs are created on bookmarks is at
  the time of opening a new window. The other bug is
  related to window closing. When a window closes,
  sometimes it deletes the bookmarks in the group
  since the tabs are closed as the window closes, and
  the extension runs in this time period. This is also
  not ideal, we should keep track of window closing
  somehow if we can.
