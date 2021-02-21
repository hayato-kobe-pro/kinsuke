var AWS = require("aws-sdk");
var dynamodb = new AWS.DynamoDB.DocumentClient();
const {
  sendSyncMail,
  sendSystemMail,
  sendSystemMailBaseOnDomain,
} = require("./src/sendMail");
const { errorCode } = require("./src/constant");
var uuid = require("uuid");
const urlWatch = "https://kinsche-dev.novelworks.jp?operation=watch";
const axios = require("axios");
const qs = require("querystring");
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRECT;
var result = [];

exports.handler = async (event) => {
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
  var params = {
    TableName: "test-stop-update-google-expires",
    ProjectionExpression:
      "id,  google_refresh_token, google_user_email, channel_expires_on, channel_id, resource_id",
    FilterExpression: "#expires < :tomorrow",
    ExpressionAttributeNames: {
      "#expires": "channel_expires_on",
    },
    ExpressionAttributeValues: {
      ":tomorrow": tomorrow,
    },
  };
  try {
    var user_records = await dynamodb.scan(params).promise();
    console.log("scan dynamodb");
    console.log("scan contents", JSON.stringify(user_records, null, 2));
  } catch (err) {
    console.log("scan dynamodb fail");
  }

  let allPromises = user_records.Items.map(async (item) => {
    try {
      console.log("google hook start");
      var today = new Date();
      var tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      var channel_expires_on = new Date();
      channel_expires_on.setDate(channel_expires_on.getDate() + 30);

      console.log("not sysn google to kintone");
      try {
        var accessToken = await getAccesstoken(item.google_refresh_token);
      } catch (err) {
        throw "getAccesstoken fail";
      }

      var calendarId = "";
      if (item.google_calendar_id != undefined && item.google_calendar_id) {
        calendarId = item.google_calendar_id;
      } else {
        calendarId = item.google_user_email;
      }
      var channelId = uuid();
      var url =
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
      var opt = {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken.access_token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        data: JSON.stringify(info),
        url: url,
      };
      let update_expire = {}
      try {
        update_expire = await axios(opt);
        console.log(update_expire);
      } catch (err) {
        throw "Post request to update channel_expires_on fail";
      }

      url = "https://www.googleapis.com/calendar/v3/channels/stop";
      opt = {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken.access_token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        data: {
          id: item.channel_id,
          resourceId: item.resource_id,
        },
        url: url,
      };
      try {
        let stop_data = await axios(opt);
        console.log("chanele top success", stop_data);//成功時のresponse dataはempty
      } catch (err) {
        throw new "Post request to stop Channels fail"();
      }

      var param = {
        TableName: "test-stop-update-google-expires",
        Key: {
          id: item.id.toString(),
        },
        UpdateExpression:
          "set channel_id=:channel_id, channel_expires_on=:channel_expires_on, resource_id=:resource_id",
        ExpressionAttributeValues: {
          ":channel_id": channelId,
          ":channel_expires_on": channel_expires_on.toISOString(),
          ":resource_id":update_expire.data.resourceId
        },
        ReturnValues: "UPDATED_NEW",
      };
      try {
        console.log("update-param",param)
        await dynamodb.update(param).promise();
        console.log("dynmodb update success");
      } catch (err) {
        console.log(err)
        throw "dynmodb update fail";
      }
    } catch (err) {
      console.log("error", item);
      console.log(err);
      result.push({ id: item.id.toString() });
    }
  });
  await Promise.all(allPromises);

  if (result.length) {
    sendSystemMail({
      error: "err",
      errorType: `一部更新失敗 primary id ${result}`,
    });
    console.log("mail送ります");
  } else {
    console.log("全ての更新成功です");
  }
};
