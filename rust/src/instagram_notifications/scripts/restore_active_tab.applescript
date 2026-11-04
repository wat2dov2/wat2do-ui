on run argv
    set intendedTabId to item 1 of argv
    set previousTabId to item 2 of argv
    set intendedWindowId to item 3 of argv
    if application "Brave Browser" is not running then error "Brave is not running."
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then error "Worker browser window is closed."
        if previousTabId is intendedTabId then return "kept_active"
        set browserWindow to window id intendedWindowId
        if ((id of active tab of browserWindow) as text) is not intendedTabId then return "kept_active"
        set tabIds to get id of every tab of browserWindow
        repeat with tabIndex from 1 to count tabIds
            if ((item tabIndex of tabIds) as text) is previousTabId then
                if ((id of active tab of browserWindow) as text) is not intendedTabId then return "kept_active"
                set active tab index of browserWindow to tabIndex
                return "restored"
            end if
        end repeat
    end tell
    return "kept_active"
end run