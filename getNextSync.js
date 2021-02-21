var AWS = require("aws-sdk");
AWS.config.update({ region: "ap-southeast-1" });
var dynamodb = new AWS.DynamoDB.DocumentClient();
require("dotenv").config();
var uuid = require("node-uuid");
const urlWatch = "https://kinsche-dev.novelworks.jp?operation=watch";
const axios = require("axios");
const qs = require("querystring");
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

  let user_info = event;

  //console.log("not sysn google to kintone");
  try {
    var accessToken = await getAccesstoken(user_info.google_refresh_token);
  } catch (err) {
    //console.log("失敗");
    throw new "getAccesstoken fail";
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

  var url =
    "https://www.googleapis.com/calendar/v3/calendars/" +
    calendarId +
    "/events";
  var opt = {
    method: "GET",
    headers: {
      Authorization: "Bearer " + accessToken.access_token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    url: url + "?syncToken=CJC1tJy46-4CEJC1tJy46-4CGAU=",
  };
  try {
    data = await axios(opt);
    console.log(data);
  } catch (err) {
    throw new "Post request to update channel_expires_on fail"();
  }
};

googleExpiresUpdate({
  app_id: "3",
  channel_expires_on: "2021-03-14T03:07:26.595Z",
  channel_id: "3d026583-0610-4401-b2d1-1b50cc6b6f72",
  domain_name: "rvmbe3wumbb0.cybozu.com",
  google_access_token:
    "ya29.A0AfH6SMAepgJ1Dsu93iximAR4D1PQWxuF2PwunFBKOHIQQKkEoDv5-DnRiGtBmTDY3GGkNsw_f4qIny1gdGKnEukCaBSGwNHiJSKtAhv-YUtRyvwqZ7h0oMyM0V_7dl1v4CXXPlL5nuyodNa1ve1LYZuWwWzV",
  google_calendar_name: "default",
  google_expires_on: "2021-02-12T04:07:26.596Z",
  google_refresh_token:
    "1//0gVzCCB4pJ8vHCgYIARAAGBASNwF-L9IreCeq1B8ECMUPMUfG8jQh2Z2yE2ujSS0yEmoZwnEAldlrBXYvIQzDQsJG3w1sW-dlXlU",
  google_user_email: "hayatoisap10@gmail.com",
  id: "1612664090500663671",
  kintone_access_token: "1.Cky2eeaqbif8B42R4i1DxsWIA2S7E4qpJHjJO9kAzo7TNd6u",
  kintone_expires_on: "2021-02-07T03:15:33.297Z",
  kintone_refresh_token: "1.wgdMA-qGR9jj8BFVNRhvyFCKCYf4Op1Jvbk1DRsrFyNV5Bwu",
  kintone_user_code: "developer@novelworks.jp",
  kintone_user_id: "1",
  kintone_user_name: "辻本大樹",
  time_zone_user: "Asia/Tokyo",
});
