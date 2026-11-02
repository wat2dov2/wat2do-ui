(() => {
  if (document.readyState !== "complete") return "";
  const profileLabel = element => [element.getAttribute("aria-label"),
    element.getAttribute("title"), element.innerText || element.textContent || ""]
    .some(value => (value || "").trim().toLowerCase() === "profile");
  const compactNavigation = candidate => {
    let scope = candidate.parentElement;
    for (let depth = 1; scope && depth <= 8; depth++, scope = scope.parentElement) {
      if (scope.matches('body,html,main,article,[role="main"],[role="dialog"]')) return false;
      const links = [...scope.querySelectorAll("a[href]")];
      const core = ["/explore/", "/reels/", "/direct/inbox/"]
        .map(route => links.find(link => link.getAttribute("href") === route));
      if (core.some(link => !link)) continue;
      // Find the actual route container, rather than accepting a page wrapper
      // that happens to contain both navigation and a viewed profile avatar.
      let navigation = core[0].parentElement;
      while (navigation !== scope && !core.every(link => navigation.contains(link))) {
        navigation = navigation.parentElement;
      }
      if (navigation.contains(candidate) &&
          !navigation.querySelector('main,article,[role="main"],[role="dialog"]') &&
          [...navigation.querySelectorAll("a[href]")].some(link => link.getAttribute("href") === "/")) {
        return true;
      }
    }
    return false;
  };
  const anchors = [...document.querySelectorAll("a[href]")].filter(candidate => {
    // Viewed profile headers and post avatars do not identify the logged account.
    // During navigation hydration, a public avatar may occupy the sidebar's old position.
    if (candidate.closest('main,article,[role="main"],[role="dialog"],[aria-hidden="true"]')) return false;
    const image = candidate.querySelector("img[alt]");
    const avatarUsername = (image?.getAttribute("alt") || "").match(/^([A-Za-z0-9._]{1,30})'s profile picture$/)?.[1];
    const hrefUsername = (candidate.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]{1,30})\/$/)?.[1];
    if (!avatarUsername || !hrefUsername || avatarUsername.toLowerCase() !== hrefUsername.toLowerCase()) return false;
    const ownedControl = candidate.closest('nav,[role="navigation"]') || profileLabel(candidate) ||
      [...candidate.querySelectorAll('[aria-label],title')].some(profileLabel) || compactNavigation(candidate);
    if (!ownedControl) return false;
    const bounds = candidate.getBoundingClientRect();
    const style = getComputedStyle(candidate);
    return bounds.width > 0 && bounds.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  });
  const usernames = [...new Set(anchors.map(anchor =>
    anchor.getAttribute("href").split("/").filter(Boolean)[0].toLowerCase()))];
  return usernames.length > 1 ? "!ambiguous" : (usernames[0] || "");
})()