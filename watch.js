const watch = async (request) => {
  console.log("watching......");
  console.log(JSON.stringify(request, null, 2));
  var res
  try {
    var params = {
      TableName: "test-kintone-google-users",
      ProjectionExpression:
        "#id, domain_name, app_id, channel_id, kintone_user_id, kintone_user_code, kintone_user_name, google_refresh_token, google_user_email, kintone_refresh_token, google_calendar_name, google_calendar_id, channel_expires_on, time_zone_user, next_sync_token, resource_id",
      FilterExpression: "channel_id = :channel_id",
      ExpressionAttributeNames: {
        "#id": "id",
      },
      ExpressionAttributeValues: {
        ":channel_id": request.headers["X-Goog-Channel-ID"],
      },
    };
    try {
      var data = await dynamodb.scan(params).promise();
    } catch (err) {
      throw err;
    }
    console.log("watch data");
    console.log(JSON.stringify(data, null, 2));
    if (
      Object.keys(data).length > 0 &&
      data.Items.length > 0 &&
      data.Items[0].kintone_refresh_token != undefined &&
      data.Items[0].kintone_refresh_token
    ) {
      console.log("google hook start");
      var today = new Date();
      var tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      var channel_expires_on = new Date();
      channel_expires_on.setDate(channel_expires_on.getDate() + 30);
      if (new Date(data.Items[0].channel_expires_on) < tomorrow) {
        // update register push notification google calendar which will expires on one month
        console.log("not sysn google to kintone");
        try {
          var accessToken = await getAccesstoken(data.Items[0].google_refresh_token);
        } catch (err) {
          throw err;
        }

        //前回のチャンネルを削除する
        var url = "https://www.googleapis.com/calendar/v3/channels/stop";
        var opt = {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken.access_token,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          data: {
            id: data.Items[0].channel_id,
            resourceId: data.Items[0].resource_id,
          },
          url: url,
        };
        try {
          let stop_data = await axios(opt);
          console.log("chanele top success", stop_data); //成功時のresponse dataはempty
        } catch (err) {
          throw new "Post request to stop Channels fail"();
        }

        var calendarId = "";
        if (
          data.Items[0].google_calendar_id != undefined &&
          data.Items[0].google_calendar_id
        ) {
          calendarId = data.Items[0].google_calendar_id;
        } else {
          calendarId = data.Items[0].google_user_email;
        }
        var channelId = uuid();
        url =
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
        opt = {
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
          var respose = await axios(opt);
        } catch (err) {
          throw err;
        }
        var param = {
          TableName: "test-kintone-google-users",
          Key: {
            id: data.Items[0].id.toString(),
          },
          UpdateExpression:
            "set channel_id=:channel_id, channel_expires_on=:channel_expires_on, resource_id=:resource_id",
          ExpressionAttributeValues: {
            ":channel_id": channelId,
            ":channel_expires_on": channel_expires_on.toISOString(),
            ":resource_id":respose.data.resourceId
          },
          ReturnValues: "UPDATED_NEW",
        };
        dynamodb.update(param, function (err, dataUser) {
          if (err) {
            sendSystemMailBaseOnDomain({
              domain: data.Items[0].domain_name,
              error: err,
              errorType: errorCode.SYS_01,
            });
            reject(err);
          } else {
            resolve(dataUser);
          }
        });
      } else {
        try {
          var accessToken  = await getAccesstoken(data.Items[0].google_refresh_token);
        } catch (err) {
          throw err;
        }
        const oAuth2Client = new google.auth.OAuth2(clientId);
        oAuth2Client.setCredentials(accessToken);
        console.log("Start sync Google to kintone");
        try {
        res = await listEvents(oAuth2Client, data.Items[0]);
        } catch (err) {
          throw err;
        }
      }
    } else {
      console.log("google hook not starting");
      res = "変更なし";
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: "err",
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify(res),
  };
};