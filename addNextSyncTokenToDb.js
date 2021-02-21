const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient({ region: "ap-southeast-1" });
require("dotenv").config();
const axios = require("axios");
const qs = require("querystring");
const clientId = process.env.Client_Id;
const clientSecret = process.env.Client_Secret;

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

async function addNextSyncTokenToDb() {
  const params = {
    TableName: "test-kintone-google-users",
  };

  
  let allRecords = await docClient.scan(params).promise();

  let allPromises = allRecords.Items.map(async (item) => {
    getAccesstoken(item.google_refresh_token)
      .then(async function (res) {
        var accessToken = res;

        var calendarId = "";
        if (item.google_calendar_id != undefined && item.google_calendar_id) {
          calendarId = item.google_calendar_id;
        } else {
          calendarId = item.google_user_email;
        }

        var url =
          "https://www.googleapis.com/calendar/v3/calendars/" +
          calendarId +
          "/events";

        var syncToken = item.next_sync_token;
        var opt = {
          method: "GET",
          headers: {
            Authorization: "Bearer " + accessToken.access_token,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          url: url + `?syncToken=${syncToken}`,
        };

        let response = await axios(opt);
        let next_sync_token = response.data.nextSyncToken;
        let params = {
          TableName: "test-empty-table",
          Item: {},
        };
        
        item.next_sync_token = next_sync_token;
        params.Item = item;

        docClient.put(params, function (err, data) {
          if (err) {
            console.log(err);
          } else {
            console.log(data);// success res is empty object
          }
        });
      })
      .catch(function (err) {
        console.log(err);
      });
  });

  await Promise.all(allPromises);
  console.log("Migration succuess")
}

addNextSyncTokenToDb();
