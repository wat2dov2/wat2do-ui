on run argv
    set intendedTabId to item 1 of argv
    set intendedWindowId to item 2 of argv
    set minimumWindowWidth to (item 3 of argv) as integer
    if application "Brave Browser" is not running then error "Brave is not running."
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then error "Worker browser window is closed."
        set browserWindow to window id intendedWindowId
        set previousTabId to (id of active tab of browserWindow) as text
        set tabIds to get id of every tab of browserWindow
        repeat with tabIndex from 1 to count tabIds
            if ((item tabIndex of tabIds) as text) is intendedTabId then
                if URL of tab id intendedTabId of browserWindow does not start with "https://www.instagram.com/" then error "Pinned Instagram tab changed site."
                if previousTabId is not intendedTabId then
                    set active tab index of browserWindow to tabIndex
                end if
                if minimumWindowWidth > 0 then
                    set windowBounds to bounds of browserWindow
                    set windowWidth to (item 3 of windowBounds) - (item 1 of windowBounds)
                    set viewportWidth to (execute tab id intendedTabId of browserWindow javascript "window.innerWidth") as integer
                    set targetWidth to minimumWindowWidth
                    if viewportWidth > 0 then set targetWidth to minimumWindowWidth + windowWidth - viewportWidth
                    if windowWidth < targetWidth then
                        set item 3 of windowBounds to (item 1 of windowBounds) + targetWidth
                        set bounds of browserWindow to windowBounds
                    end if
                end if
                return previousTabId
            end if
        end repeat
    end tell
    error "Pinned Instagram tab is closed."
end run