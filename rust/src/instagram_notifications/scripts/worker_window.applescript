on run argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        repeat with browserWindowId in (get id of every window)
            try
                set browserWindow to window id (contents of browserWindowId)
                if (get id of every tab of browserWindow) contains (item 1 of argv) then
                    return (id of browserWindow) as text
                end if
            on error detail number errorCode
                if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                if exists window id (contents of browserWindowId) then error detail number errorCode
            end try
        end repeat
    end tell
    error "Pinned Instagram tab is closed."
end run