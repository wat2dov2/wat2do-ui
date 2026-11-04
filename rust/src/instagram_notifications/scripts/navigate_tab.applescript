on run argv
    set intendedTabId to item 1 of argv
    set targetUrl to item 2 of argv
    set intendedWindowId to item 3 of argv
    set reloadTarget to item 4 of argv
    set navigationSource to item 5 of argv
    if application "Brave Browser" is not running then error "Brave is not running."
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then error "Worker browser window is closed."
        set browserWindow to window id intendedWindowId
        if not (exists tab id intendedTabId of browserWindow) then error "Pinned Instagram tab is closed."
        set browserTab to tab id intendedTabId of browserWindow
        if URL of browserTab does not start with "https://www.instagram.com/" then error "Pinned Instagram tab changed site."
        set currentUrl to URL of browserTab
        if currentUrl starts with "https://www.instagram.com/accounts/login" or currentUrl starts with "https://www.instagram.com/accounts/suspended" or currentUrl starts with "https://www.instagram.com/challenge" or currentUrl starts with "https://www.instagram.com/checkpoint" then error "Instagram requires human account recovery."
        if reloadTarget is "false" and URL of browserTab is targetUrl then return "already_open"
        try
            with timeout of 2 seconds
                execute browserTab javascript navigationSource
            end timeout
        on error errorMessage number errorCode
            if errorCode is not -1712 then error errorMessage number errorCode
            -- Brave's URL setter also raises the app, so it only rescues a hung page.
            set URL of browserTab to targetUrl
        end try
        return "navigating"
    end tell
end run