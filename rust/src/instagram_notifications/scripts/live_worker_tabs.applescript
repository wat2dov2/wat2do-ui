on run argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    set foundIds to ""
    tell application "Brave Browser"
        repeat with browserWindowId in (get id of every window)
            try
                set browserWindow to window id (contents of browserWindowId)
                repeat with browserTabId in (get id of every tab of browserWindow)
                    set tabId to (contents of browserTabId) as text
                    if argv contains tabId then
                        try
                            if URL of tab id tabId of browserWindow starts with "https://www.instagram.com/" then
                                set foundIds to foundIds & tabId & linefeed
                            end if
                        on error detail number errorCode
                            if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                        end try
                    end if
                end repeat
            on error detail number errorCode
                if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
            end try
        end repeat
    end tell
    return foundIds
end run