const { Expo } = require("expo-server-sdk");

const expo = new Expo();

exports.sendPushNotification = async (
  pushToken,
  title,
  body,
  data = {}
) => {
  try {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.log("Invalid Expo push token:", pushToken);
      return;
    }

    const messages = [
      {
        to: pushToken,
        sound: "default",
        title,
        body,
        data,
      },
    ];

    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      console.log("Notification tickets:", tickets);
    }
  } catch (error) {
    console.error("Push notification error:", error);
  }
};
