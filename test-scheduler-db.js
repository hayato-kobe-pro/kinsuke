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
  //再帰で有効期限の切れたレコードを取得してreturnします
    const scanDynamo = async function (obj) {
      try {
        // scan用のパラメーターをセット
        const params = obj;
        // scanで取得したデータを格納する空の配列を定義しておく
        let items = [];
    
        const scan = async () => {
          const scan_result = await dynamodb.scan(params).promise();
          items.push(...scan_result.Items);
    
          // scanリクエストを行なった時にLastEvaluatedKeyがあれば、再帰的にリクエストを繰り返す
          if (scan_result.LastEvaluatedKey) {
            params.ExclusiveStartKey = scan_result.LastEvaluatedKey;
            await scan();
          }
        };
    
        await scan();
        return items;
      } catch (err) {
        throw err;
      }
    };
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

  let tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow = tomorrow.toISOString();
  let params = {
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
  let user_records 
  try {
    //再帰処理で実行する
    user_records = await scanDynamo(params)
    // var user_records = await dynamodb.scan(params).promise();
    console.log("scan dynamodb");
    console.log("scan contents", JSON.stringify(user_records, null, 2));
  } catch (err) {
    console.log("scan dynamodb fail");
  }

  let allPromises = user_records.map(async (item) => {
    try {
      console.log("google hook start");
      let today = new Date();
      let tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      let channel_expires_on = new Date();
      channel_expires_on.setDate(channel_expires_on.getDate() + 30);

      console.log("not sync google to kintone");
      let accessToken
      try {
        accessToken = await getAccesstoken(item.google_refresh_token);
      } catch (err) {
        throw "getAccesstoken fail";
      }

      let calendarId = "";
      if (item.google_calendar_id != undefined && item.google_calendar_id) {
        calendarId = item.google_calendar_id;
      } else {
        calendarId = item.google_user_email;
      }
      let channelId = uuid();
      let url =
        "https://www.googleapis.com/calendar/v3/calendars/" +
        calendarId +
        "/events/watch";
      let info = {
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
        console.log("chanele top success", stop_data.data);//成功時のresponse dataはempty
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


