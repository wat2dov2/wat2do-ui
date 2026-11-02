on run argv
    set intendedTabId to item 1 of argv
    set javascriptSource to item 2 of argv
    set intendedWindowId to item 3 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id intendedWindowId
        if not (exists tab id intendedTabId of browserWindow) then
            error "Pinned Instagram tab is closed."
        end if
        set browserTab to tab id intendedTabId of browserWindow
        if URL of browserTab does not start with "https://www.instagram.com/" then
            error "Pinned Instagram tab changed site."
        end if
        if javascriptSource is not "JSON.stringify({width: window.innerWidth, height: window.innerHeight})" and loading of browserTab then error "Pinned Instagram tab is loading."
        return execute browserTab javascript javascriptSource
    end tell
end run