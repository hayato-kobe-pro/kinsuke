var AWS = require("aws-sdk");
AWS.config.update({ region: "ap-southeast-1" });
var dynamodb = new AWS.DynamoDB.DocumentClient();
require("dotenv").config();
var uuid = require("node-uuid");
const urlWatch = "https://kinsche-dev.novelworks.jp?operation=watch";
const axios = require("axios");
const qs = require("querystring");
const { IoTEvents } = require("aws-sdk");
const clientId = process.env.Client_Id;
const clientSecret = process.env.Client_Secret;

const googleExpiresUpdate = async (event) => {
  // Get accessToken in Google Calendar by refreshToken
  const getAccesstoken = (refreshToken) => {
    return new Promise(function (resolve, reject) {
      const data = {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      };
      const options = {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        data: qs.stringify(data),
        url: "https://oauth2.googleapis.com/token",
      };
      axios(options)
        .then((response) => {
          resolve(response.data);
        })
        .catch(function (error) {
          reject(error);
        });
    });
  };

  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow = tomorrow.toISOString();

  let user_info = event;

  console.log("google hook start");
  var today = new Date();
  var tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  var channel_expires_on = new Date();
  channel_expires_on.setDate(channel_expires_on.getDate() + 30);

  console.log("not sysn google to kintone");
  try {
    var accessToken = await getAccesstoken(user_info.google_refresh_token);
  } catch (err) {
    console.log(err);
    throw new "getAccesstoken fail"();
  }

  var calendarId = "";
  if (
    user_info.google_calendar_id != undefined &&
    user_info.google_calendar_id
  ) {
    calendarId = user_info.google_calendar_id;
  } else {
    calendarId = user_info.google_user_email;
  }
  var channelId = uuid.v1();
  let url =
    "https://www.googleapis.com/calendar/v3/calendars/" +
    calendarId +
    "/events/watch";
  var info = {
    id: channelId,
    type: "web_hook",
    address: urlWatch,
    params: {
      ttl: 2591000,
    },
  };
  let opt = {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken.access_token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: JSON.stringify(info),
    url: url,
  };
  try {
    data = await axios(opt);
    console.log(data);
  } catch (err) {
    throw new "Post request to update channel_expires_on fail"();
  }

  //一つのcalendar_idに複数のchannel_idを作成出来ないうようにする必要がある
  url = "https://www.googleapis.com/calendar/v3/channels/stop";
  opt = {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken.access_token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: {
      id: user_info.channel_Id,
      resourceId: user_info.resource_Id,
    },
    url: url,
  };
  try {
    data = await axios(opt);
    console.log(data);
  } catch (err) {
    throw new "Post request to stop Channels fail"();
  }

  var param = {
    TableName: "test-update-google-expires",
    Key: {
      id: user_info.id.toString(),
    },
    UpdateExpression:
      "set channel_id=:channel_id, channel_expires_on=:channel_expires_on",
    ExpressionAttributeValues: {
      ":channel_id": channelId,
      ":channel_expires_on": channel_expires_on.toISOString(),
    },
    ReturnValues: "UPDATED_NEW",
  };
  try {
    await dynamodb.update(param).promise();
    console.log("dynmodb update success");
    return "success";
  } catch (err) {
    console.log(err);
    throw new "dynmodb update fail"();
  }
};

module.exports = googleExpiresUpdate;
