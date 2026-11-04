on run argv
    set openerTabId to item 1 of argv
    set popupSource to item 2 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        set frontWindowId to missing value
        if (count windows) > 0 then set frontWindowId to id of window 1
        set knownWindowIds to get id of every window
        set opener to missing value
        set bootstrapId to missing value
        if openerTabId is not "" then
            repeat with browserWindowId in knownWindowIds
                try
                    set browserWindow to window id (contents of browserWindowId)
                    if exists tab id openerTabId of browserWindow then
                        if URL of tab id openerTabId of browserWindow starts with "https://www.instagram.com/" then
                            set opener to tab id openerTabId of browserWindow
                        end if
                        exit repeat
                    end if
                on error detail number errorCode
                    if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                end try
            end repeat
        end if
        if opener is missing value then
            set bootstrapWindow to make new window
            set bootstrapId to id of bootstrapWindow
            set end of knownWindowIds to bootstrapId
            set opener to active tab of bootstrapWindow
            set URL of opener to "about:blank"
            delay 0.5
        end if
        execute opener javascript popupSource
        set popupTabId to missing value
        repeat 40 times
            repeat with browserWindowId in (get id of every window)
                if knownWindowIds does not contain (contents of browserWindowId) then
                    set popupWindow to window id (contents of browserWindowId)
                    if (count tabs of popupWindow) is 1 then
                        set popupTabId to (id of active tab of popupWindow) as text
                    end if
                end if
            end repeat
            if popupTabId is not missing value then exit repeat
            delay 0.25
        end repeat
        if bootstrapId is not missing value then
            if exists window id bootstrapId then close window id bootstrapId
        end if
        if frontWindowId is not missing value then
            if exists window id frontWindowId then set index of window id frontWindowId to 1
        end if
        if popupTabId is missing value then error "Worker Instagram window did not open."
        return popupTabId
    end tell
end run