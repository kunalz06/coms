export const NotificationService = {
    requestPermission: async () => {
        if (!("Notification" in window)) return false;
        if (Notification.permission === "granted") return true;
        const permission = await Notification.requestPermission();
        return permission === "granted";
    },

    send: (title, options = {}) => {
        if (!("Notification" in window) || Notification.permission !== "granted") return;

        try {
            const notification = new Notification(title, {
                icon: "/icon.png", // We might need to add an icon later
                badge: "/badge.png",
                vibrate: [200, 100, 200],
                ...options
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
                if (options.onClick) options.onClick();
            };

            return notification;
        } catch (e) {
            console.error("Notification failed", e);
        }
    }
};
