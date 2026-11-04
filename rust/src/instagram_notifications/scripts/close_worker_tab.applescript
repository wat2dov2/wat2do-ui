on run argv
    set intendedTabId to item 1 of argv
    set registeredWindowId to item 2 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        if not (exists window id registeredWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id registeredWindowId
        if exists tab id intendedTabId of browserWindow then
            set browserTab to tab id intendedTabId of browserWindow
            if URL of browserTab does not start with "https://www.instagram.com/" then
                error "Pinned Instagram tab changed site."
            end if
            close browserTab
        end if
    end tell
    return "closed"
end run