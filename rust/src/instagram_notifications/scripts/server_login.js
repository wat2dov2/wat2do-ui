(() => {
 const request = new XMLHttpRequest();
 request.open("GET", "/accounts/edit/", false);
 request.send();
 return new URL(request.responseURL).pathname.startsWith("/accounts/login") ? "logged_out" : "logged_in";
})()