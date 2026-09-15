// My Day — service worker for push notifications (Phase 3, part 2).
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "My Day", body: event.data ? event.data.text() : "" };
  }

  var title = data.title || "My Day";
  var options = {
    body: data.body || "",
    data: { url: data.url || "./" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        if ("focus" in windowClients[i]) return windowClients[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
