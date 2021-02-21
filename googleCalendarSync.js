var AWS = require("aws-sdk");
var dynamodb = new AWS.DynamoDB.DocumentClient();
var request = require("request");
var uuid = require("uuid");
var moment = require("moment-timezone");
const axios = require("axios");
const qs = require("querystring");
const { google } = require("googleapis");
const {
  sendSyncMail,
  sendSystemMail,
  sendSystemMailBaseOnDomain,
} = require("./src/sendMail");
const { errorCode } = require("./src/constant");
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRECT;
const timeZone = "Asia/Tokyo";
const redirectUriGoogle =
  "https://kinsche-dev.novelworks.jp?operation=configGoogle";
const redirectUriKintone =
  "https://kinsche-dev.novelworks.jp?operation=configKintone";
const urlWatch = "https://kinsche-dev.novelworks.jp?operation=watch";
const maxEvent = 100;
const pluginID = process.env.pluginID;

exports.handler = async (event) => {
  const operation = event.queryStringParameters
    ? event.queryStringParameters.operation
    : null;
  if (!operation) {
    var html =
      '<html><head><meta name="google-site-verification" content="LsDcIsjZvwunIIxPgJcZRtq7wQlRLk2e3fm4OR-Kp-4" /></head>' +
      "<body>Hello world</body></html>";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
      },
      body: html,
    };
  } else {
    console.log("operation", operation);
    switch (operation) {
      case "get":
        return {
          statusCode: 200,
          body: JSON.stringify("Hello from Lambda!"),
        };
      case "save":
        var data = JSON.parse(event.body);
        return await addData(data);
      case "webhookKintone":
        var data = JSON.parse(event.body);
        return await syncKintoneToGoogle(data);
      case "bulkDelete":
        //console.log(event)
        var data = JSON.parse(event.body);
        return await bulkDelete(data);
      case "bulkPost":
        var data = JSON.parse(event.body);
        return await bulkPost(data);
      // return {
      //   statusCode: 200,
      //   body: 'success'
      // };
      case "bulkPut":
        var data = JSON.parse(event.body);

        return await bulkPut(data);
      // return {
      //   statusCode: 200,
      //   body: 'success'
      // };
      case "deleteEvent":
        var data = JSON.parse(event.body);
        return await deleteEventKintoneToGoogle(data);
      case "configGoogle":
        var data = event.queryStringParameters;
        return await configGoogle(data);
      case "configKintone":
        var data = event.queryStringParameters;
        return await configKintone(data);
      case "checkLoginKintone":
        var data = JSON.parse(event.body);
        return await checkLoginKintone(data);
      case "checkLoginGoogle":
        var data = JSON.parse(event.body);
        return await checkLoginGoogle(data);
      case "getLoggedGoogle":
        var data = JSON.parse(event.body);
        return await getLoggedGoogle(data);
      case "getCalendarName":
        var data = JSON.parse(event.body);
        return await getCalendarName(data);
      case "saveConfigSetting":
        var data = JSON.parse(event.body);
        return await saveConfigSetting(data);
      case "watch":
        return await watch(event);
      default:
        return {
          statusCode: 401,
          body: JSON.stringify(`Unrecognized operation "${operation}"`),
        };
    }
  }
};

// Webhook Google Calendar
const watch = (request) => {
  console.log("watching......");
  console.log(JSON.stringify(request, null, 2));
  return new Promise(function (resolve, reject) {
    var params = {
      TableName: "test-kintone-google-users",
      ProjectionExpression:
        "#id, domain_name, app_id, channel_id, kintone_user_id, kintone_user_code, kintone_user_name, google_refresh_token, google_user_email, kintone_refresh_token, google_calendar_name, google_calendar_id, channel_expires_on, time_zone_user, next_sync_token",
      FilterExpression: "channel_id = :channel_id",
      ExpressionAttributeNames: {
        "#id": "id",
      },
      ExpressionAttributeValues: {
        ":channel_id": request.headers["X-Goog-Channel-ID"],
      },
    };
    dynamodb.scan(params, function (err, data) {
      if (err) {
        sendSystemMail({ error: err, errorType: errorCode.SYS_01 });
        reject(err);
      } else {
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
            getAccesstoken(data.Items[0].google_refresh_token)
              .then(function (res) {
                var accessToken = res;
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
                axios(opt)
                  .then((response) => {
                    var param = {
                      TableName: "test-kintone-google-users",
                      Key: {
                        id: data.Items[0].id.toString(),
                      },
                      UpdateExpression:
                        "set channel_id=:channel_id, channel_expires_on=:channel_expires_on",
                      ExpressionAttributeValues: {
                        ":channel_id": channelId,
                        ":channel_expires_on": channel_expires_on.toISOString(),
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
                  })
                  .catch((err) => {
                    reject(err);
                  });
              })
              .catch(function (err) {
                sendSystemMailBaseOnDomain({
                  domain: data.Items[0].domain_name,
                  error: err,
                  errorType: errorCode.SYS_01,
                });
                reject(err);
              });
          } else {
            getAccesstoken(data.Items[0].google_refresh_token)
              .then(function (res) {
                var accessToken = res;
                const oAuth2Client = new google.auth.OAuth2(clientId);
                oAuth2Client.setCredentials(accessToken);
                console.log("Start sync Google to kintone");
                listEvents(oAuth2Client, data.Items[0])
                  .then(function (res) {
                    resolve(res);
                  })
                  .catch(function (err) {
                    sendSystemMailBaseOnDomain({
                      domain: data.Items[0].domain_name,
                      error: err,
                      errorType: errorCode.SYS_01,
                    });
                    reject(err);
                  });
              })
              .catch(function (err) {
                sendSystemMailBaseOnDomain({
                  domain: data.Items[0].domain_name,
                  error: err,
                  errorType: errorCode.SYS_01,
                });
                reject(err);
              });
          }
        } else {
          console.log("google hook not starting");
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: JSON.stringify(res),
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: "err",
      };
    });
};
// const watch = async (request) => {
//   return new Promise(function (resolve, reject) {
//     var params = {
//       TableName : 'test-kintone-google-users',
//       ProjectionExpression:'#id, domain_name, app_id, channel_id, kintone_user_id, kintone_user_code, kintone_user_name, google_refresh_token, google_user_email, kintone_refresh_token, google_calendar_name, google_calendar_id, channel_expires_on, time_zone_user',
//       FilterExpression: 'channel_id = :channel_id',
//       ExpressionAttributeNames: {
//         '#id': 'id',
//       },
//       ExpressionAttributeValues: {
//         ':channel_id': request.headers['X-Goog-Channel-ID']
//       }
//     };
//     dynamodb.scan(params, function(err, data) {
//       if (err) {
//         sendSystemMail({error: err, errorType: errorCode.SYS_01});
//         reject(err);
//       } else {
//         if (Object.keys(data).length > 0 && data.Items.length > 0  && data.Items[0].kintone_refresh_token != undefined && data.Items[0].kintone_refresh_token) {
//           console.log('google hook start');
//           var today = new Date();
//           var tomorrow = new Date();
//           tomorrow.setDate(today.getDate()+1);
//           var channel_expires_on = new Date();
//           channel_expires_on.setDate(channel_expires_on.getDate() + 30);
//           if (new Date(data.Items[0].channel_expires_on) < tomorrow) { // update register push notification google calendar which will expires on one month
//             getAccesstoken(data.Items[0].google_refresh_token).then(function(res) {
//               var accessToken = res;
//               var calendarId = '';
//               if (data.Items[0].google_calendar_id != undefined && data.Items[0].google_calendar_id) {
//                 calendarId = data.Items[0].google_calendar_id;
//               } else {
//                 calendarId = data.Items[0].google_user_email;
//               }
//               var channelId = uuid();
//               var url = 'https://www.googleapis.com/calendar/v3/calendars/' + calendarId + '/events/watch';
//               var info = {
//                 'id': channelId,
//                 'type': 'web_hook',
//                 'address': urlWatch,
//                 'params': {
//                   'ttl' : 2591000
//                 }
//               };
//               var opt = {
//                 method: 'POST',
//                 headers: {'Authorization': 'Bearer ' + accessToken.access_token, 'Content-Type': 'application/json', 'Accept': 'application/json'},
//                 data: JSON.stringify(info),
//                 url: url
//               };
//               axios(opt).then(response => {
//                 var param = {
//                   TableName:'test-kintone-google-users',
//                   Key:{
//                     'id': data.Items[0].id.toString(),
//                   },
//                   UpdateExpression: "set channel_id=:channel_id, channel_expires_on=:channel_expires_on",
//                   ExpressionAttributeValues:{
//                     ':channel_id': channelId,
//                     ':channel_expires_on': channel_expires_on.toISOString()
//                   },
//                   ReturnValues: 'UPDATED_NEW'
//                 };
//                 dynamodb.update(param, function(err, dataUser) {
//                   if (err) {
//                     sendSystemMailBaseOnDomain({ domain: data.Items[0].domain_name, error: err, errorType: errorCode.SYS_01 });
//                     reject(err);
//                   } else {
//                     resolve(dataUser);
//                   }
//                 });
//               }).catch(err => {
//                 reject(err);
//               });
//             }).catch(function(err) {
//               sendSystemMailBaseOnDomain({domain: data.Items[0].domain_name, error: err, errorType: errorCode.SYS_01});
//               reject(err);
//             });
//           } else {
//             getAccesstoken(data.Items[0].google_refresh_token).then(function(res) {
//               var accessToken = res;
//               const oAuth2Client = new google.auth.OAuth2(clientId);
//               oAuth2Client.setCredentials(accessToken);
//               console.log('Start sync Google to kintone');
//               listEvents(oAuth2Client, data.Items[0]).then(function(res) {
//                 resolve(res);
//               }).catch(function(err) {
//                 sendSystemMailBaseOnDomain({domain: data.Items[0].domain_name, error: err, errorType: errorCode.SYS_01});
//                 reject(err);
//               });
//             }).catch(function(err) {
//               sendSystemMailBaseOnDomain({domain: data.Items[0].domain_name, error: err, errorType: errorCode.SYS_01});
//               reject(err);
//             });
//           }
//         }
//       }
//     });
//   }).then(function(res) {
//     return {
//       statusCode: 200,
//       body: JSON.stringify(res)
//     };
//   }).catch(function(err) {
//     return {
//       statusCode: 500,
//       body: 'err'
//     };
//   });
// };

// Save config setting plugin
const saveConfigSetting = async (config) => {
  var domain = config.domain;
  var appId = config.appId;
  var params = {
    TableName: "test-kintone-google-settings",
    Key: {
      domain_name: domain,
      app_id: appId.toString(),
    },
  };
  var userRemove = config.userRemove;
  return new Promise(function (resolve, reject) {
    for (let index = 0; index < userRemove.length; index++) {
      var paramsRemove = {
        TableName: "test-kintone-google-users",
        Key: {
          id: userRemove[index].toString(),
        },
      };
      dynamodb.delete(paramsRemove, function (err, data) {
        if (err) {
          reject(err);
        }
      });
    }
    dynamodb.get(params, async function (err, dataDb) {
      if (err) {
        reject(err);
      } else {
        if (Object.keys(dataDb).length > 0) {
          var data = await updateKintoneGoogleSetting(config);
          resolve(data);
        } else {
          var data = await insertKintoneGoogleSetting(config);
          resolve(data);
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: "success",
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: JSON.stringify(err),
      };
    });
};

const updateKintoneGoogleSetting = async (config) => {
  var domain = config.domain;
  var appId = config.appId;
  var params = {
    TableName: "test-kintone-google-settings",
    Key: {
      domain_name: domain,
      app_id: appId.toString(),
    },
    UpdateExpression:
      "set mapping_fields=:mapping_fields, kintone_client_id=:kintone_client_id, kintone_client_secret=:kintone_client_secret, calendar_plugin=:calendar_plugin, user_info=:user_info, user_email=:user_email, updated_at=:updated_at",
    ExpressionAttributeValues: {
      ":mapping_fields": JSON.parse(config.eventInfo),
      ":kintone_client_id": config.kintoneClientId,
      ":kintone_client_secret": config.kintoneClientSecret,
      ":calendar_plugin": config.calendarPlugin,
      ":user_info": JSON.parse(config.userFieldInfo),
      ":user_email": config.userEmail,
      ":updated_at": new Date().toISOString(),
    },
    ReturnValues: "UPDATED_NEW",
  };
  return new Promise(function (resolve, reject) {
    dynamodb.update(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

const insertKintoneGoogleSetting = async (config) => {
  var domain = config.domain;
  var appId = config.appId;
  var params = {
    TableName: "test-kintone-google-settings",
    Item: {
      domain_name: domain,
      app_id: appId.toString(),
      mapping_fields: JSON.parse(config.eventInfo),
      kintone_client_id: config.kintoneClientId,
      kintone_client_secret: config.kintoneClientSecret,
      calendar_plugin: config.calendarPlugin,
      user_info: JSON.parse(config.userFieldInfo),
      user_email: config.userEmail,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.put(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

// Save config when click login google

const configGoogle = async (data) => {
  console.log(
    "starting config google with data: ",
    JSON.stringify(data, null, 2)
  );
  var state = JSON.parse(data.state);
  var domain = state.domain;
  var appId = state.appId;
  var kintoneUserId = state.kintoneUserId;
  var kintoneUserCode = state.kintoneUserCode;
  var kintoneUserName = state.kintoneUserName;
  var timeZoneUser = state.timeZone != undefined ? state.timeZone : timeZone;
  var code = data.code;
  var calendarName = state.calendarName ? state.calendarName : "default";
  const dataOptions = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUriGoogle,
    code: code,
    grant_type: "authorization_code",
  };
  console.log("config gooole....");
  console.log("client secrect ", clientSecret);

  const options = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: qs.stringify(dataOptions),
    url: "https://oauth2.googleapis.com/token",
  };
  return new Promise(function (resolve, reject) {
    axios(options)
      .then((response) => {
        var accessToken = response.data.access_token;
        var refreshToken = response.data.refresh_token;
        const option = {
          method: "GET",
          url:
            "https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=" +
            response.data.id_token,
        };
        axios(option)
          .then((response) => {
            var email = response.data.email;
            var channelId = uuid();
            var paramsUser = {
              TableName: "test-kintone-google-users",
              ProjectionExpression:
                "#id, domain_name, app_id, kintone_user_code, google_user_email",
              FilterExpression:
                "domain_name = :domain_name and kintone_user_code = :kintone_user_code",
              ExpressionAttributeNames: {
                "#id": "id",
              },
              ExpressionAttributeValues: {
                ":domain_name": domain,
                ":kintone_user_code": kintoneUserCode,
              },
            };
            dynamodb.scan(paramsUser, function (err, dataDb) {
              if (err) {
                reject(err);
              } else {
                var channel_expires_on = new Date();
                channel_expires_on.setDate(channel_expires_on.getDate() + 30);
                var google_expires_on = new Date();
                google_expires_on.setHours(google_expires_on.getHours() + 1);

                console.log("email: ", email);
                console.log("Data db: ", JSON.stringify(dataDb, null, 2));
                console.log("appId", appId);
                if (Object.keys(dataDb).length > 0 && dataDb.Items.length > 0) {
                  let listEmail = dataDb.Items.filter(
                    (x) => x.app_id != appId
                  ).map((x) => x.google_user_email);

                  console.log("list email", listEmail);
                  if (listEmail.includes(email)) {
                    console.log("email conflict");
                    reject("error");
                  } else {
                    let found = dataDb.Items.find((x) => x.app_id == appId);
                    if (found) {
                      console.log("found and start update...");
                      updateGoogleUser(
                        found.id,
                        domain,
                        appId,
                        kintoneUserId,
                        kintoneUserCode,
                        kintoneUserName,
                        channelId,
                        channel_expires_on,
                        email,
                        accessToken,
                        refreshToken,
                        google_expires_on,
                        calendarName,
                        timeZoneUser
                      )
                        .then((data) => resolve(data))
                        .catch((err) => reject(err));
                    }
                  }
                } else {
                  let id = generateId();
                  insertGoogleUser(
                    id,
                    domain,
                    appId,
                    kintoneUserId,
                    kintoneUserCode,
                    kintoneUserName,
                    channelId,
                    channel_expires_on,
                    email,
                    accessToken,
                    refreshToken,
                    google_expires_on,
                    calendarName,
                    timeZoneUser
                  )
                    .then((data) => resolve(data))
                    .catch((err) => reject(err));
                }
              }
            });
          })
          .catch(function (error) {
            reject(error);
          });
        // axios(option).then(response => {
        //         var email = response.data.email;
        //         var channelId = uuid();
        //         var paramsUser = {
        //           TableName : 'test-kintone-google-users',
        //           ProjectionExpression:'#id, domain_name, app_id, kintone_user_code',
        //           FilterExpression: 'domain_name = :domain_name and app_id = :app_id and kintone_user_code = :kintone_user_code',
        //           ExpressionAttributeNames: {
        //             '#id': 'id',
        //           },
        //           ExpressionAttributeValues: {
        //             ':domain_name': domain,
        //             ':app_id': (appId).toString(),
        //             ':kintone_user_code': kintoneUserCode
        //           }
        //         };
        //         dynamodb.scan(paramsUser, async function(err, dataDb) {
        //           if (err) {
        //             reject(err);
        //           } else {
        //             var channel_expires_on = new Date();
        //             channel_expires_on.setDate(channel_expires_on.getDate() + 30);
        //             var google_expires_on = new Date();
        //             google_expires_on.setHours(google_expires_on.getHours() + 1);
        //             if (Object.keys(dataDb).length > 0 && dataDb.Items.length > 0) {
        //               var data = await updateGoogleUser(dataDb.Items[0].id, domain, appId, kintoneUserId, kintoneUserCode, kintoneUserName, channelId, channel_expires_on, email, accessToken, refreshToken, google_expires_on, calendarName, timeZoneUser);
        //               resolve(data);
        //             } else {
        //               let id = generateId();
        //               var data = await insertGoogleUser(id, domain, appId, kintoneUserId, kintoneUserCode, kintoneUserName, channelId, channel_expires_on, email, accessToken, refreshToken, google_expires_on, calendarName, timeZoneUser);
        //               resolve(data);
        //             }
        //           }
        //         });
        //       }).catch(function (error) {
        //         reject(error);
        //       });
      })
      .catch(function (error) {
        console.log(error.response);
        reject(error);
      });
  })
    .then(function (res) {
      var html = "<html><head><script>window.close()</script></head></html>";
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/html",
        },
        body: html,
      };
    })
    .catch(function (err) {
      var html = "<html><head><script>window.close()</script></head></html>";
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "text/html",
        },
        body: html,
      };
    });
};

const updateGoogleUser = async (
  id,
  domain,
  appId,
  kintoneUserId,
  kintoneUserCode,
  kintoneUserName,
  channelId,
  channel_expires_on,
  email,
  accessToken,
  refreshToken,
  google_expires_on,
  calendarName,
  timeZoneUser
) => {
  var params = {
    TableName: "test-kintone-google-users",
    Key: {
      id: id,
    },
    UpdateExpression: `set domain_name=:domain_name,
                      app_id=:app_id,
                      kintone_user_id=:kintone_user_id,
                      kintone_user_code=:kintone_user_code,
                      kintone_user_name=:kintone_user_name, 
                      channel_id=:channel_id, 
                      channel_expires_on=:channel_expires_on, 
                      google_user_email=:google_user_email, 
                      google_access_token=:google_access_token, 
                      google_refresh_token=:google_refresh_token, 
                      google_expires_on=:google_expires_on, 
                      google_calendar_name=:google_calendar_name,
                      time_zone_user=:time_zone_user`,
    ExpressionAttributeValues: {
      ":domain_name": domain,
      ":app_id": appId.toString(),
      ":kintone_user_id": kintoneUserId,
      ":kintone_user_code": kintoneUserCode,
      ":kintone_user_name": kintoneUserName,
      ":channel_id": channelId,
      ":channel_expires_on": channel_expires_on.toISOString(),
      ":google_user_email": email,
      ":google_access_token": accessToken,
      ":google_refresh_token": refreshToken,
      ":google_expires_on": google_expires_on.toISOString(),
      ":google_calendar_name": calendarName,
      ":time_zone_user": timeZoneUser,
    },
    ReturnValues: "UPDATED_NEW",
  };

  console.log("startig update test-kintone-google-users...");
  return new Promise(function (resolve, reject) {
    dynamodb.update(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        console.log("update done");
        resolve(data);
      }
    });
  });
};

const insertGoogleUser = async (
  id,
  domain,
  appId,
  kintoneUserId,
  kintoneUserCode,
  kintoneUserName,
  channelId,
  channel_expires_on,
  email,
  accessToken,
  refreshToken,
  google_expires_on,
  calendarName,
  timeZoneUser
) => {
  var params = {
    TableName: "test-kintone-google-users",
    Item: {
      id: id,
      domain_name: domain,
      app_id: appId.toString(),
      kintone_user_id: kintoneUserId,
      kintone_user_code: kintoneUserCode,
      kintone_user_name: kintoneUserName,
      channel_id: channelId,
      channel_expires_on: channel_expires_on.toISOString(),
      google_user_email: email,
      google_access_token: accessToken,
      google_refresh_token: refreshToken,
      google_expires_on: google_expires_on.toISOString(),
      google_calendar_name: calendarName,
      time_zone_user: timeZoneUser,
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.put(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

// Save config when click button login Kintone

const configKintone = async (data) => {
  console.log(JSON.stringify(data));
  var state = data.state.split(":");
  var domain = state[0];
  var appId = state[1];
  var kintoneUserId = state[2];
  var kintoneUserCode = state[3];
  var kintoneUserName = state[4];
  var code = data.code;
  var paramsSetting = {
    TableName: "test-kintone-google-settings",
    Key: {
      domain_name: domain,
      app_id: appId.toString(),
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.get(paramsSetting, function (err, dataConf) {
      if (err) {
        console.error(err);
        reject(err);
      } else {
        if (Object.keys(dataConf).length > 0) {
          const dataOptions = {
            redirect_uri: redirectUriKintone,
            code: code,
            client_id: dataConf.Item.kintone_client_id,
            client_secret: dataConf.Item.kintone_client_secret,
            grant_type: "authorization_code",
          };
          const options = {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            data: qs.stringify(dataOptions),
            url: "https://" + domain + "/oauth2/token",
          };
          axios(options)
            .then((response) => {
              var accessToken = response.data.access_token;
              var refreshToken = response.data.refresh_token;
              var paramsUser = {
                TableName: "test-kintone-google-users",
                ProjectionExpression:
                  "#id, domain_name, app_id, kintone_user_code",
                FilterExpression:
                  "domain_name = :domain_name and app_id = :app_id and kintone_user_code = :kintone_user_code",
                ExpressionAttributeNames: {
                  "#id": "id",
                },
                ExpressionAttributeValues: {
                  ":domain_name": domain,
                  ":app_id": appId.toString(),
                  ":kintone_user_code": kintoneUserCode,
                },
              };
              dynamodb.scan(paramsUser, async function (err, dataDb) {
                if (err) {
                  sendSystemMailBaseOnDomain({
                    domain,
                    error: err,
                    errorType: errorCode.SYS_01,
                  });
                  reject(err);
                } else {
                  var kintone_expires_on = new Date();
                  kintone_expires_on.setHours(
                    kintone_expires_on.getHours() + 1
                  );
                  if (
                    Object.keys(dataDb).length > 0 &&
                    dataDb.Items.length > 0
                  ) {
                    var data = await updateKintoneUser(
                      dataDb.Items[0].id,
                      domain,
                      appId,
                      kintoneUserId,
                      kintoneUserCode,
                      kintoneUserName,
                      accessToken,
                      refreshToken,
                      kintone_expires_on
                    );
                    resolve(data);
                  } else {
                    let id = generateId();
                    var data = await insertKintoneUser(
                      id,
                      domain,
                      appId,
                      kintoneUserId,
                      kintoneUserCode,
                      kintoneUserName,
                      accessToken,
                      refreshToken,
                      kintone_expires_on
                    );
                    resolve(data);
                  }
                }
              });
            })
            .catch(function (error) {
              reject(error);
            });
        } else {
          reject("err");
        }
      }
    });
  })
    .then(function (res) {
      var html = "<html><head><script>window.close()</script></head></html>";
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/html",
        },
        body: html,
      };
    })
    .catch(function (err) {
      console.error(err);
      var html = "<html><head><script>window.close()</script></head></html>";
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "text/html",
        },
        body: html,
      };
    });
};

const updateKintoneUser = async (
  id,
  domain,
  appId,
  kintoneUserId,
  kintoneUserCode,
  kintoneUserName,
  accessToken,
  refreshToken,
  kintone_expires_on
) => {
  var params = {
    TableName: "test-kintone-google-users",
    Key: {
      id: id,
    },
    UpdateExpression: `set domain_name=:domain_name,
                      app_id=:app_id,
                      kintone_user_id=:kintone_user_id,
                      kintone_user_code=:kintone_user_code,
                      kintone_user_name=:kintone_user_name, 
                      kintone_access_token=:kintone_access_token, 
                      kintone_refresh_token=:kintone_refresh_token, 
                      kintone_expires_on=:kintone_expires_on`,
    ExpressionAttributeValues: {
      ":domain_name": domain,
      ":app_id": appId.toString(),
      ":kintone_user_id": kintoneUserId,
      ":kintone_user_code": kintoneUserCode,
      ":kintone_user_name": kintoneUserName,
      ":kintone_access_token": accessToken,
      ":kintone_refresh_token": refreshToken,
      ":kintone_expires_on": kintone_expires_on.toISOString(),
    },
    ReturnValues: "UPDATED_NEW",
  };

  return new Promise(function (resolve, reject) {
    dynamodb.update(params, function (err, data) {
      if (err) {
        sendSystemMailBaseOnDomain({
          domain,
          error: err,
          errorType: errorCode.SYS_01,
        });
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

const insertKintoneUser = async (
  id,
  domain,
  appId,
  kintoneUserId,
  kintoneUserCode,
  kintoneUserName,
  accessToken,
  refreshToken,
  kintone_expires_on
) => {
  var params = {
    TableName: "test-kintone-google-users",
    Item: {
      id: id,
      domain_name: domain,
      app_id: appId.toString(),
      kintone_user_id: kintoneUserId,
      kintone_user_code: kintoneUserCode,
      kintone_user_name: kintoneUserName,
      kintone_access_token: accessToken,
      kintone_refresh_token: refreshToken,
      kintone_expires_on: kintone_expires_on.toISOString(),
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.put(params, function (err, data) {
      if (err) {
        sendSystemMailBaseOnDomain({
          domain,
          error: err,
          errorType: errorCode.SYS_01,
        });
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

// Sync an event from Kintone to Google Calendar
const syncKintoneToGoogle = async (body) => {
  console.log("hook test");
  if (body.type != "DELETE_RECORD" && body.url && body.app.id) {
    console.log("hook update record event", JSON.stringify(body));
    var record = body.record;
    console.log("record update", JSON.stringify(record));
    var domain = await extractHostname(body.url);
    let check = await checkAuth(domain, pluginID);

    console.log("check auth: ", check);
    if (!check) {
      console.log("trail end");
      return {
        statusCode: 200,
        body: "end time",
      };
    }

    var appId = body.app.id;
    var paramsSetting = {
      TableName: "test-kintone-google-settings",
      Key: {
        domain_name: domain,
        app_id: appId.toString(),
      },
    };
    return new Promise(function (resolve, reject) {
      dynamodb.get(paramsSetting, function (err, dataDb) {
        if (err) {
          sendSystemMailBaseOnDomain({
            domain,
            error: err,
            errorType: errorCode.SYS_01,
          });
          reject(err);
        } else {
          if (Object.keys(dataDb).length > 0) {
            var calendarPlugin = dataDb.Item.calendar_plugin;
            var mappingFields = dataDb.Item.mapping_fields;

            var userInfo = dataDb.Item.user_info;
            var paramsUser = {
              TableName: "test-kintone-google-users",
              ProjectionExpression:
                "#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, kintone_refresh_token, google_calendar_id, google_user_email",
              FilterExpression:
                "domain_name = :domain_name and app_id = :app_id",
              ExpressionAttributeNames: {
                "#id": "id",
              },
              ExpressionAttributeValues: {
                ":domain_name": domain,
                ":app_id": appId.toString(),
              },
            };
            dynamodb.scan(paramsUser, function (err, data) {
              if (err) {
                sendSystemMailBaseOnDomain({
                  domain,
                  error: err,
                  errorType: errorCode.SYS_01,
                });
                reject(err);
              } else {
                if (Object.keys(data).length > 0 && data.Items.length > 0) {
                  for (
                    let indexData = 0;
                    indexData < data.Items.length;
                    indexData++
                  ) {
                    if (
                      (!mappingFields.membersField &&
                        userInfo &&
                        userInfo.field &&
                        typeof record[userInfo.field] !== "undefined" &&
                        ((record[userInfo.field]["type"] === "CREATOR" &&
                          data.Items[indexData].kintone_user_code ===
                            record[userInfo.field]["value"]["code"]) ||
                          (record[userInfo.field]["type"] === "USER_SELECT" &&
                            record[userInfo.field]["value"].length > 0 &&
                            data.Items[indexData].kintone_user_code ==
                              record[userInfo.field]["value"][0].code))) ||
                      (mappingFields.membersField &&
                        record[mappingFields.membersField].value.length &&
                        data.Items[indexData].kintone_user_code ==
                          record[mappingFields.membersField].value[0].code)
                    ) {
                      var kintoneUserCode =
                        data.Items[indexData].kintone_user_code;
                      // if (calendarPlugin == 'koyomi' && mappingFields.membersField && record[mappingFields.membersField].value.length){
                      //   kintoneUserCode =  record[mappingFields.membersField].value[0].code;
                      // }
                      console.log("kintoneUserCode: ", kintoneUserCode);
                      var kintoneUserName =
                        data.Items[indexData].kintone_user_name;
                      var calendarId = "primary";
                      if (
                        data.Items[indexData].google_calendar_name != "default"
                      ) {
                        calendarId = data.Items[indexData].google_calendar_id;
                      }
                      var kintoneRefreshToken =
                        data.Items[indexData].kintone_refresh_token;
                      getAccesstoken(data.Items[indexData].google_refresh_token)
                        .then(function (res) {
                          var accessToken = res;
                          const oAuth2Client = new google.auth.OAuth2(clientId);
                          oAuth2Client.setCredentials(accessToken);
                          var startTime = formatISO8601(
                            new Date(record[mappingFields.start].value)
                          );
                          if (record[mappingFields.end].value) {
                            var endTime = formatISO8601(
                              new Date(record[mappingFields.end].value)
                            );
                          } else {
                            var startDate = formatDateISO8601(
                              new Date(
                                new Date(
                                  record[mappingFields.start].value
                                ).toLocaleString("en-US", {
                                  timeZone: "Asia/Tokyo",
                                })
                              )
                            );
                            // var endTime = formatISO8601(new Date(startDate + 'T23:59:59+09:00'));
                            var endTime = formatISO8601(
                              new Date(record[mappingFields.start].value)
                            );
                          }
                          var description = mappingFields.description
                            ? record[mappingFields.description].value
                            : "";
                          var location = mappingFields.location
                            ? record[mappingFields.location].value
                            : "";
                          var showAllDay = "";
                          if (
                            calendarPlugin == "default" ||
                            calendarPlugin == "calendar-plus" ||
                            calendarPlugin == "none-calendar"
                          ) {
                            showAllDay =
                              mappingFields.showAllDay &&
                              record[mappingFields.showAllDay].value.length > 0
                                ? record[mappingFields.showAllDay].value[0]
                                : "";
                          } else {
                            if (
                              (mappingFields.showAllDay &&
                                record[mappingFields.showAllDay].value.length >
                                  0) ||
                              record[mappingFields.type].value ==
                                mappingFields.optionsType[1]
                            ) {
                              showAllDay = mappingFields.optionsType[1];
                            }
                          }
                          var attendees = [];
                          if (
                            mappingFields.attendees != undefined &&
                            record[mappingFields.attendees].value &&
                            record[mappingFields.attendees].value.length > 0
                          ) {
                            for (
                              let index = 0;
                              index <
                              record[mappingFields.attendees].value.length;
                              index++
                            ) {
                              for (
                                let indexDataAtten = 0;
                                indexDataAtten < data.Items.length;
                                indexDataAtten++
                              ) {
                                if (
                                  data.Items[indexDataAtten]
                                    .kintone_user_code ==
                                  record[mappingFields.attendees].value[index]
                                    .code
                                ) {
                                  if (
                                    data.Items[indexDataAtten]
                                      .kintone_user_code == kintoneUserCode
                                  )
                                    continue;
                                  var attend = {
                                    email:
                                      data.Items[indexDataAtten]
                                        .google_user_email,
                                    displayName:
                                      record[mappingFields.attendees].value[
                                        index
                                      ].name,
                                    responseStatus: "needsAction",
                                  };
                                  // var attend = {
                                  //   'email': data.Items[indexDataAtten].google_user_email,
                                  //   'displayName': record[mappingFields.attendees].value[index].name,
                                  // };
                                  // if (data.Items[indexDataAtten].kintone_user_code != kintoneUserCode) {
                                  //   attend['responseStatus'] = 'needsAction';
                                  // } else {
                                  //   attend['responseStatus'] = 'accepted';
                                  //   attend['organizer'] = true;
                                  // }
                                  attendees.push(attend);
                                  break;
                                }
                              }
                            }
                          }

                          var event = {};
                          event = {
                            summary: record[mappingFields.summary].value,
                            description: description,
                            location: location,
                            attendees: attendees,
                            extendedProperties: {
                              private: {
                                kintoneRecordId: record["$id"].value,
                              },
                            },
                          };
                          if (showAllDay) {
                            var startDate = new Date(
                              new Date(
                                record[mappingFields.start].value
                              ).toLocaleString("en-US", {
                                timeZone: "Asia/Tokyo",
                              })
                            );
                            if (record[mappingFields.end].value) {
                              var endDate = new Date(
                                new Date(
                                  record[mappingFields.end].value
                                ).toLocaleString("en-US", {
                                  timeZone: "Asia/Tokyo",
                                })
                              );
                              if (
                                calendarPlugin == "default" ||
                                calendarPlugin == "koyomi"
                              ) {
                                endDate.setDate(endDate.getDate() + 1);
                              }
                              //endDate.setDate(endDate.getDate() + 1)
                            } else {
                              endDate = startDate;
                            }
                            event["start"] = {
                              date: formatDateISO8601(startDate),
                              timeZone: timeZone,
                            };
                            event["end"] = {
                              date: formatDateISO8601(endDate),
                              timeZone: timeZone,
                            };
                          } else {
                            event["start"] = {
                              dateTime: startTime,
                              timeZone: timeZone,
                            };
                            event["end"] = {
                              dateTime: endTime,
                              timeZone: timeZone,
                            };
                          }
                          if (body.type == "ADD_RECORD") {
                            insertEvent(oAuth2Client, calendarId, event)
                              .then(function (res) {
                                resolve(res);
                              })
                              .catch(function (err) {
                                sendSyncMail({
                                  domain,
                                  errorType: errorCode.SYN_04,
                                  emailNoti: dataDb.Item.user_email,
                                  idRecordKintone: record.$id.value,
                                  subject: record[mappingFields.summary].value,
                                });
                                console.log(err);
                                reject(err);
                              });
                          } else if (body.type == "UPDATE_RECORD") {
                            getEventByKintoneId(
                              oAuth2Client,
                              calendarId,
                              record["$id"].value
                            )
                              .then(function (res) {
                                console.log("update", JSON.stringify(event));
                                updateEvent(
                                  oAuth2Client,
                                  calendarId,
                                  res.id,
                                  event
                                )
                                  .then(function (res) {
                                    resolve(res);
                                  })
                                  .catch(function (err) {
                                    sendSyncMail({
                                      domain,
                                      errorType: errorCode.SYN_05,
                                      emailNoti: dataDb.Item.user_email,
                                      idRecordKintone: record.$id.value,
                                      subject:
                                        record[mappingFields.summary].value,
                                    });
                                    console.log("error", err);
                                    reject(err);
                                  });
                              })
                              .catch(function (err) {
                                // insert event Google calendar from record update Kintone which has Googlekey not exist in Google Calendar
                                insertEvent(oAuth2Client, calendarId, event)
                                  .then(function (res) {
                                    resolve(res);
                                  })
                                  .catch(function (err) {
                                    sendSyncMail({
                                      domain,
                                      errorType: errorCode.SYN_04,
                                      emailNoti: dataDb.Item.user_email,
                                      idRecordKintone: record.$id.value,
                                      subject:
                                        record[mappingFields.summary].value,
                                    });
                                    reject(err);
                                  });
                              });
                          }
                        })
                        .catch(function (err) {
                          sendSyncMail({
                            domain,
                            errorType: errorCode.SYN_08,
                            emailNoti: dataDb.Item.user_email,
                          });
                          reject(err);
                        });
                    }
                  }
                } else {
                  reject("error");
                }
              }
            });
          } else {
            reject("err");
          }
        }
      });
    })
      .then(function (res) {
        return {
          statusCode: 200,
          body: "success",
        };
      })
      .catch(function (err) {
        return {
          statusCode: 500,
          body: JSON.stringify(err),
        };
      });
  } else {
    return {
      statusCode: 500,
      body: JSON.stringify("Not found!"),
    };
  }
};

const bulkPut = async (body) => {
  console.log("bulk Put body", JSON.stringify(body, null, 2));
  const domain = body.domain;
  const appId = body.app;
  const records = body.records;

  // if (!domain || !appId || !records){
  //   return {
  //     statusCode: 400,
  //     body: 'invalid parameter',
  //   }
  // }

  // if (!records.length){
  //   return {
  //     statusCode: 400,
  //     body: 'invalid records',
  //   }
  // }

  // if (records.length >= 100){
  //   return {
  //     statusCode: 400,
  //     body: 'records limit 100',
  //   }
  // }

  // const  getParam = {
  //   TableName: 'test-kintone-google-settings',
  //   Key: {
  //     'domain_name': domain,
  //     'app_id': appId.toString()
  //   }
  // };

  // const setting = await dynamodb.get(getParam).promise();
  // if (setting.Item){
  //   const calendarPlugin = setting.Item.calendar_plugin;
  //   const mappingFields = setting.Item.mapping_fields;
  //   const userInfo = setting.Item.user_info;
  //   const paramsUser = {
  //     TableName : 'test-kintone-google-users',
  //     ProjectionExpression:'#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, kintone_refresh_token, google_calendar_id, google_user_email',
  //     FilterExpression: 'domain_name = :domain_name and app_id = :app_id',
  //     ExpressionAttributeNames: {
  //       '#id': 'id',
  //     },
  //     ExpressionAttributeValues: {
  //       ':domain_name': domain,
  //       ':app_id': (appId).toString()
  //     }
  //   };
  //   const data = await dynamodb.scan(paramsUser).promise();
  //   if (data.Items.length){
  //     for (let i = 0; i < records.length; i++){
  //       let record = records[i];
  //       for (let indexData = 0; indexData < data.Items.length; indexData++) {
  //         // if (
  //         //   (userInfo['type'] == 'CREATOR' && data.Items[indexData].kintone_user_code == record[userInfo['field']]['value']['code'])
  //         // )
  //         // {
  //           if (
  //             ( !mappingFields.membersField && userInfo['type'] == 'CREATOR' && data.Items[indexData].kintone_user_code == record[userInfo['field']]['value']['code']) ||
  //             ( mappingFields.membersField && record[mappingFields.membersField].value.length && data.Items[indexData].kintone_user_code == record[mappingFields.membersField].value[0].code)
  //           ) {
  //           var kintoneUserCode = data.Items[indexData].kintone_user_code;
  //           var kintoneUserName = data.Items[indexData].kintone_user_name;
  //           var calendarId = 'primary';
  //           if (data.Items[indexData].google_calendar_name != 'default') {
  //             calendarId = data.Items[indexData].google_calendar_id;
  //           }
  //           var kintoneRefreshToken = data.Items[indexData].kintone_refresh_token;

  //           //try{
  //             const accessToken = await  getAccesstoken(data.Items[indexData].google_refresh_token);
  //             const oAuth2Client = new google.auth.OAuth2(clientId);
  //             oAuth2Client.setCredentials(accessToken);
  //             if (record[mappingFields.start] ){
  //               var startTime = formatISO8601(new Date(record[mappingFields.start].value));
  //             }
  //             if (record[mappingFields.end] ) {
  //               if (record[mappingFields.end.value]){
  //                 var endTime = formatISO8601(new Date(record[mappingFields.end].value));
  //               }else{
  //                 var endTime = formatISO8601(new Date(record[mappingFields.start].value));
  //               }
  //             }

  //             var description =  '';
  //             if (record[mappingFields.description]){
  //               description = record[mappingFields.description].value;
  //             }
  //             var location = '';
  //             if ( record[mappingFields.location]){
  //               location = record[mappingFields.location].value;
  //             }
  //             var showAllDay = '';
  //             if (calendarPlugin == 'default'|| calendarPlugin == 'calendar-plus' || calendarPlugin == 'none-calendar' ) {
  //               showAllDay = (record[mappingFields.showAllDay] && mappingFields.showAllDay && record[mappingFields.showAllDay].value.length > 0) ? record[mappingFields.showAllDay].value[0] : '';
  //             } else {
  //               if ((mappingFields.showAllDay &&  record[mappingFields.showAllDay] && record[mappingFields.showAllDay].value.length > 0) || record[mappingFields.type] && record[mappingFields.type].value == mappingFields.optionsType[1]) {
  //                 showAllDay = mappingFields.optionsType[1];
  //               }
  //             }

  //             var attendees = [];
  //             if (mappingFields.attendees != undefined && record[mappingFields.attendees] && record[mappingFields.attendees].value.length > 0) {
  //               for (let index = 0; index < record[mappingFields.attendees].value.length; index++) {
  //                 for (let indexDataAtten = 0; indexDataAtten < data.Items.length; indexDataAtten++) {
  //                   if (data.Items[indexDataAtten].kintone_user_code == record[mappingFields.attendees].value[index].code) {
  //                     var attend = {
  //                       'email': data.Items[indexDataAtten].google_user_email,
  //                       'displayName': record[mappingFields.attendees].value[index].name
  //                     };
  //                     if (data.Items[indexDataAtten].kintone_user_code != kintoneUserCode) {
  //                       attend['responseStatus'] = 'needsAction';
  //                     } else {
  //                       attend['responseStatus'] = 'accepted';
  //                     }
  //                     // if (data.Items[indexDataAtten].kintone_user_code == kintoneUserCode) continue;
  //                     // var attend = {
  //                     //   'email': data.Items[indexDataAtten].google_user_email,
  //                     //   'displayName': record[mappingFields.attendees].value[index].name,
  //                     //   'responseStatus' :  'needsAction'
  //                     // };
  //                     attendees.push(attend);
  //                     break;
  //                   }
  //                 }
  //               }
  //             }

  //             let event = {
  //               'extendedProperties': {
  //                 'private': {
  //                   'kintoneRecordId': record['$id'].value
  //                 }
  //               }
  //             };
  //             if(record[mappingFields.summary]) event['summary'] =  record[mappingFields.summary].value;
  //             if (description) event['description'] = description;
  //             if (location) event['location'] = location;
  //             if (attendees.length) event['attendees'] = attendees;
  //             // const event = {
  //             //   'summary': record[mappingFields.summary].value,
  //             //   'description': description,
  //             //   'location': location,
  //             //   'attendees': attendees,
  //             //   'extendedProperties': {
  //             //     'private': {
  //             //       'kintoneRecordId': record['$id'].value
  //             //     }
  //             //   }
  //             // };

  //             if (showAllDay) {
  //               if (record[mappingFields.start]){
  //                 var startDate = new Date(new Date(record[mappingFields.start].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  //                 event['start'] = {
  //                   'date': formatDateISO8601(startDate),
  //                   'timeZone': timeZone,
  //                 };
  //               }

  //               if (record[mappingFields.end]) {
  //                 var endDate = new Date(new Date(record[mappingFields.end].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  //                 //endDate.setDate(endDate.getDate() + 1)
  //                 if (calendarPlugin == 'default' || calendarPlugin == 'koyomi'){
  //                   endDate.setDate(endDate.getDate() + 1)
  //                 }
  //                 event['end'] = {
  //                   'date': formatDateISO8601(endDate),
  //                   'timeZone': timeZone,
  //                 };
  //               }
  //             } else {
  //               if (startTime) {
  //                 event['start'] = {
  //                   'dateTime': startTime,
  //                   'timeZone': timeZone,
  //                 };
  //               }
  //               if (endTime){
  //                 event['end'] = {
  //                   'dateTime': endTime,
  //                   'timeZone': timeZone,
  //                 };
  //               }
  //             }
  //             try {
  //               let getEventByKintoneIdResp = await getEventByKintoneId(oAuth2Client, calendarId, record['$id'].value);
  //               try {
  //                 await  updateEvent(oAuth2Client, calendarId, getEventByKintoneIdResp.id, event);
  //               }catch(err){
  //                 sendSyncMail({ domain, errorType: errorCode.SYN_05, emailNoti: dataDb.Item.user_email, idRecordKintone: record.$id.value, subject: record[mappingFields.summary].value});
  //                 return {
  //                   statusCode: 400,
  //                   body: JSON.stringify(err),
  //                 };
  //               }

  //             }catch(err){
  //               // insert event Google calendar from record update Kintone which has Googlekey not exist in Google Calendar
  //               try {
  //                 await insertEvent(oAuth2Client, calendarId, event);
  //               }catch(err){
  //                 sendSyncMail({ domain, errorType: errorCode.SYN_04, emailNoti: dataDb.Item.user_email, idRecordKintone: record.$id.value, subject: record[mappingFields.summary].value});
  //                 return {
  //                   statusCode: 400,
  //                   body: JSON.stringify(err),
  //                 };
  //               }
  //             }
  //           // }catch(err){
  //           //   console.log(JSON.stringify(err, null, 2));
  //           //   sendSyncMail({ domain, errorType: errorCode.SYN_08, emailNoti: dataDb.Item.user_email});
  //           //   return {
  //           //     statusCode: 400,
  //           //     body: JSON.stringify(err),
  //           //   };
  //           // }
  //         }
  //       }
  //     }
  //   }else{
  //     return {
  //       statusCode: 400,
  //       body: 'Not found',
  //     }
  //   }
  // }else{
  //   return {
  //     statusCode: 400,
  //     body: 'Not found',
  //   }
  // }
  // console.log('bulk put success');
  return {
    statusCode: 200,
    body: "success",
  };
};

const bulkDelete = async (body) => {
  console.log("bulk Delete");

  const domain = body.domain;
  const appId = body.app;
  const records = body.records;
  try {
    if (!domain || !appId || !records) {
      return {
        statusCode: 400,
        body: "invalid parameter",
      };
    }

    if (!records.length) {
      return {
        statusCode: 400,
        body: "invalid records",
      };
    }

    if (records.length >= 100) {
      return {
        statusCode: 400,
        body: "records limit 100",
      };
    }

    const getParam = {
      TableName: "test-kintone-google-settings",
      Key: {
        domain_name: domain,
        app_id: appId.toString(),
      },
    };

    const setting = await dynamodb.get(getParam).promise();
    if (setting.Item) {
      const calendarPlugin = setting.Item.calendar_plugin;
      const mappingFields = setting.Item.mapping_fields;
      const userInfo = setting.Item.user_info;
      const paramsUser = {
        TableName: "test-kintone-google-users",
        ProjectionExpression:
          "#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, kintone_refresh_token, google_calendar_id, google_user_email",
        FilterExpression: "domain_name = :domain_name and app_id = :app_id",
        ExpressionAttributeNames: {
          "#id": "id",
        },
        ExpressionAttributeValues: {
          ":domain_name": domain,
          ":app_id": appId.toString(),
        },
      };
      const data = await dynamodb.scan(paramsUser).promise();
      if (data.Items.length) {
        for (let i = 0; i < records.length; i++) {
          let record = records[i];
          for (let indexData = 0; indexData < data.Items.length; indexData++) {
            // if (
            //   (userInfo['type'] == 'CREATOR' && data.Items[indexData].kintone_user_code == record[userInfo['field']]['value']['code']) ||
            //   (userInfo['type'] == 'USER_SELECT' && record[userInfo['field']]['value'].length > 0 && data.Items[indexData].kintone_user_code == record[userInfo['field']]['value'][0]['code'])
            // )
            // {
            if (
              (userInfo["type"] == "CREATOR" &&
                record[userInfo["field"]] &&
                data.Items[indexData].kintone_user_code ==
                  record[userInfo["field"]]["value"]["code"]) ||
              (record[mappingFields.membersField] &&
                record[mappingFields.membersField].value.length &&
                data.Items[indexData].kintone_user_code ==
                  record[mappingFields.membersField].value[0].code)
            ) {
              var kintoneUserCode = data.Items[indexData].kintone_user_code;
              var kintoneUserName = data.Items[indexData].kintone_user_name;
              var calendarId = "primary";
              if (data.Items[indexData].google_calendar_name != "default") {
                calendarId = data.Items[indexData].google_calendar_id;
              }
              var kintoneRefreshToken =
                data.Items[indexData].kintone_refresh_token;

              try {
                const accessToken = await getAccesstoken(
                  data.Items[indexData].google_refresh_token
                );
                const oAuth2Client = new google.auth.OAuth2(clientId);
                oAuth2Client.setCredentials(accessToken);

                try {
                  let getEventByKintoneIdResp = await getEventByKintoneId(
                    oAuth2Client,
                    calendarId,
                    record["$id"].value
                  );
                  try {
                    await deleteEvent(
                      oAuth2Client,
                      calendarId,
                      getEventByKintoneIdResp.id
                    );
                  } catch (err) {
                    console.log(JSON.stringify(err, null, 2));
                    sendSyncMail({
                      domain,
                      errorType: errorCode.SYN_06,
                      emailNoti: dataDb.Item.user_email,
                      idRecordKintone: record.$id.value,
                      subject: record[mappingFields.summary].value,
                    });
                    return {
                      statusCode: 400,
                      body: JSON.stringify(err),
                    };
                  }
                } catch (err) {
                  console.log("errr:");
                  console.log(JSON.stringify(err, null, 2));
                  return {
                    statusCode: 400,
                    body: JSON.stringify(err),
                  };
                }
              } catch (err) {
                console.log("fail");
                console.log(JSON.stringify(err, null, 2));
                sendSyncMail({
                  domain,
                  errorType: errorCode.SYN_08,
                  emailNoti: dataDb.Item.user_email,
                });
                return {
                  statusCode: 400,
                  body: JSON.stringify(err),
                };
              }
            }
          }
        }
      } else {
        console.log("not found");
        return {
          statusCode: 400,
          body: "Not found",
        };
      }
    } else {
      console.log("not found");
      return {
        statusCode: 400,
        body: "Not found",
      };
    }
    console.log("bulk put success");
    return {
      statusCode: 200,
      body: "success",
    };
  } catch (err) {
    console.log(JSON.stringify(err, null, 2));
    sendSystemMailBaseOnDomain({
      domain,
      error: err,
      errorType: errorCode.SYS_01,
    });
    return {
      statusCode: 400,
      body: JSON.stringify(err),
    };
  }
};

const bulkPost = async (body) => {
  console.log("bulk Post boyd", JSON.stringify(body, null, 2));
  const domain = body.domain;
  const appId = body.app;
  const records = body.records;

  // if (!domain || !appId || !records){
  //   return {
  //     statusCode: 400,
  //     body: 'invalid parameter',
  //   }
  // }

  // if (!records.length){
  //   return {
  //     statusCode: 400,
  //     body: 'invalid records',
  //   }
  // }

  // if (records.length >= 100){
  //   return {
  //     statusCode: 400,
  //     body: 'records limit 100',
  //   }
  // }

  // const  getParam = {
  //   TableName: 'test-kintone-google-settings',
  //   Key: {
  //     'domain_name': domain,
  //     'app_id': appId.toString()
  //   }
  // };

  // const setting = await dynamodb.get(getParam).promise();
  // if (setting.Item){
  //   const calendarPlugin = setting.Item.calendar_plugin;
  //   const mappingFields = setting.Item.mapping_fields;
  //   const userInfo = setting.Item.user_info;
  //   const paramsUser = {
  //     TableName : 'test-kintone-google-users',
  //     ProjectionExpression:'#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, kintone_refresh_token, google_calendar_id, google_user_email',
  //     FilterExpression: 'domain_name = :domain_name and app_id = :app_id',
  //     ExpressionAttributeNames: {
  //       '#id': 'id',
  //     },
  //     ExpressionAttributeValues: {
  //       ':domain_name': domain,
  //       ':app_id': (appId).toString()
  //     }
  //   };
  //   console.log('userInfo',JSON.stringify(userInfo, null, 2));
  //   const data = await dynamodb.scan(paramsUser).promise();
  //   if (data.Items.length){
  //     for (let i = 0; i < records.length; i++){
  //       let record = records[i];
  //       for (let indexData = 0; indexData < data.Items.length; indexData++) {
  //         // if (
  //         //   (userInfo['type'] == 'CREATOR' && data.Items[indexData].kintone_user_code == record[userInfo['field']]['value']['code'])
  //         // )
  //         if (
  //           ( !mappingFields.membersField && userInfo['type'] == 'CREATOR' && data.Items[indexData].kintone_user_code == record[userInfo['field']]['value']['code']) ||
  //           ( mappingFields.membersField && record[mappingFields.membersField].value.length && data.Items[indexData].kintone_user_code == record[mappingFields.membersField].value[0].code)
  //         )
  //         {
  //           var kintoneUserCode = data.Items[indexData].kintone_user_code;
  //           var kintoneUserName = data.Items[indexData].kintone_user_name;
  //           var calendarId = 'primary';
  //           if (data.Items[indexData].google_calendar_name != 'default') {
  //             calendarId = data.Items[indexData].google_calendar_id;
  //           }
  //           var kintoneRefreshToken = data.Items[indexData].kintone_refresh_token;
  //           console.log(1);
  //           try{
  //             const accessToken = await  getAccesstoken(data.Items[indexData].google_refresh_token);
  //             const oAuth2Client = new google.auth.OAuth2(clientId);
  //             oAuth2Client.setCredentials(accessToken);
  //             var startTime = formatISO8601(new Date(record[mappingFields.start].value));
  //             if (record[mappingFields.end].value) {
  //               var endTime = formatISO8601(new Date(record[mappingFields.end].value));
  //             } else {
  //               var startDate = formatDateISO8601(new Date(new Date(record[mappingFields.start].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"})));
  //               // var endTime = formatISO8601(new Date(startDate + 'T23:59:59+09:00'));
  //               var endTime = formatISO8601(new Date(record[mappingFields.start].value));
  //             }
  //             var description = mappingFields.description ? record[mappingFields.description].value : '';
  //             var location = mappingFields.location ? record[mappingFields.location].value : '';
  //             var showAllDay = '';
  //             if (calendarPlugin == 'default' || calendarPlugin == 'calendar-plus' || calendarPlugin == 'none-calendar') {
  //               showAllDay = (mappingFields.showAllDay && record[mappingFields.showAllDay].value.length > 0) ? record[mappingFields.showAllDay].value[0] : '';
  //             } else {
  //               if ((mappingFields.showAllDay && record[mappingFields.showAllDay].value.length > 0) || record[mappingFields.type].value == mappingFields.optionsType[1]) {
  //                 showAllDay = mappingFields.optionsType[1];
  //               }
  //             }
  //             console.log(2);
  //             var attendees = [];
  //             if (mappingFields.attendees != undefined && record[mappingFields.attendees].value && record[mappingFields.attendees].value.length > 0) {
  //               for (let index = 0; index < record[mappingFields.attendees].value.length; index++) {
  //                 for (let indexDataAtten = 0; indexDataAtten < data.Items.length; indexDataAtten++) {
  //                   if (data.Items[indexDataAtten].kintone_user_code == record[mappingFields.attendees].value[index].code) {
  //                     var attend = {
  //                       'email': data.Items[indexDataAtten].google_user_email,
  //                       'displayName': record[mappingFields.attendees].value[index].name
  //                     };
  //                     if (data.Items[indexDataAtten].kintone_user_code != kintoneUserCode) {
  //                       attend['responseStatus'] = 'needsAction';
  //                     } else {
  //                       attend['responseStatus'] = 'accepted';
  //                     }
  //                     // if (data.Items[indexDataAtten].kintone_user_code == kintoneUserCode) continue;
  //                     // var attend = {
  //                     //   'email': data.Items[indexDataAtten].google_user_email,
  //                     //   'displayName': record[mappingFields.attendees].value[index].name,
  //                     //   'responseStatus' :  'needsAction'
  //                     // };
  //                     attendees.push(attend);
  //                     break;
  //                   }
  //                 }
  //               }
  //             }

  //             const event = {
  //               'summary': record[mappingFields.summary].value,
  //               'description': description,
  //               'location': location,
  //               'attendees': attendees,
  //               'extendedProperties': {
  //                 'private': {
  //                   'kintoneRecordId': record['$id'].value
  //                 }
  //               }
  //             };

  //             if (showAllDay) {
  //               var startDate = new Date(new Date(record[mappingFields.start].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  //               if (record[mappingFields.end].value) {
  //                 var endDate = new Date(new Date(record[mappingFields.end].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  //                 //endDate.setDate(endDate.getDate() + 1)
  //                 if (calendarPlugin == 'default' || calendarPlugin == 'koyomi'){
  //                   endDate.setDate(endDate.getDate() + 1)
  //                 }
  //               } else {
  //                 endDate = startDate;
  //               }
  //               event['start'] = {
  //                 'date': formatDateISO8601(startDate),
  //                 'timeZone': timeZone,
  //               };
  //               event['end'] = {
  //                 'date': formatDateISO8601(endDate),
  //                 'timeZone': timeZone,
  //               };
  //             } else {
  //               event['start'] = {
  //                 'dateTime': startTime,
  //                 'timeZone': timeZone,
  //               };
  //               event['end'] = {
  //                 'dateTime': endTime,
  //                 'timeZone': timeZone,
  //               };
  //             }
  //             try {
  //               await insertEvent(oAuth2Client, calendarId, event);
  //             }catch(err){
  //               console.log(JSON.stringify(err, null, 2))
  //               sendSyncMail({ domain, errorType: errorCode.SYN_04, emailNoti: dataDb.Item.user_email, idRecordKintone: record.$id.value, subject: record[mappingFields.summary].value});
  //               return {
  //                 statusCode: 400,
  //                 body: JSON.stringify(err),
  //               };
  //             }
  //           }catch(err){
  //             console.log(JSON.stringify(err, null, 2))
  //             sendSyncMail({ domain, errorType: errorCode.SYN_08, emailNoti: dataDb.Item.user_email});
  //             return {
  //               statusCode: 400,
  //               body: JSON.stringify(err),
  //             };
  //           }
  //         }
  //       }
  //     }
  //   }else{
  //     return {
  //       statusCode: 400,
  //       body: 'Not found',
  //     }
  //   }
  // }else{
  //   return {
  //     statusCode: 400,
  //     body: 'Not found',
  //   }
  // }
  console.log("bulk post success");
  return {
    statusCode: 200,
    body: "success",
  };
};

// Sync delete event from Kintone to Google
const deleteEventKintoneToGoogle = async (body) => {
  var params = {
    TableName: "test-kintone-google-users",
    ProjectionExpression:
      "#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, google_calendar_id",
    FilterExpression:
      "domain_name = :domain_name and app_id = :app_id and kintone_user_code = :kintone_user_code",
    ExpressionAttributeNames: {
      "#id": "id",
    },
    ExpressionAttributeValues: {
      ":domain_name": body.domain,
      ":app_id": body.appId.toString(),
      ":kintone_user_code": body.kintoneUserCode,
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.scan(params, function (err, data) {
      if (err) {
        sendSystemMailBaseOnDomain({
          domain: body.domain,
          error: err,
          errorType: errorCode.SYS_01,
        });
        reject(err);
      } else {
        if (Object.keys(data).length > 0 && data.Items.length > 0) {
          var calendarId = "primary";
          if (data.Items[0].google_calendar_name != "default") {
            calendarId = data.Items[0].google_calendar_id;
          }
          getAccesstoken(data.Items[0].google_refresh_token)
            .then(function (res) {
              var accessToken = res;
              const oAuth2Client = new google.auth.OAuth2(clientId);
              oAuth2Client.setCredentials(accessToken);
              getEventByKintoneId(oAuth2Client, calendarId, body.eventId)
                .then(function (res) {
                  deleteEvent(oAuth2Client, calendarId, res.id)
                    .then(function (res) {
                      resolve(res);
                    })
                    .catch(function (err) {
                      sendSyncMail({
                        domain: body.domain,
                        errorType: errorCode.SYN_06,
                        emailNoti: body.userEmail,
                        subject: body.title,
                      });
                      reject(err);
                    });
                })
                .catch(function (err) {
                  reject(err);
                });
            })
            .catch(function (err) {
              sendSyncMail({
                domain: body.domain,
                errorType: errorCode.SYN_07,
                emailNoti: body.userEmail,
              });
              reject(err);
            });
        } else {
          reject("error");
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: JSON.stringify(res),
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: JSON.stringify(err),
      };
    });
};

// Check Login Kintone
const checkLoginKintone = async (body) => {
  var params = {
    TableName: "test-kintone-google-users",
    ProjectionExpression:
      "#id, domain_name, app_id, kintone_user_code, kintone_refresh_token",
    FilterExpression:
      "domain_name = :domain_name and app_id = :app_id and kintone_user_code = :kintone_user_code",
    ExpressionAttributeNames: {
      "#id": "id",
    },
    ExpressionAttributeValues: {
      ":domain_name": body.domain,
      ":app_id": body.appId.toString(),
      ":kintone_user_code": body.kintoneUserCode,
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.scan(params, function (err, data) {
      if (err) {
        sendSystemMailBaseOnDomain({
          domain: body.domain,
          error: err,
          errorType: errorCode.SYS_01,
        });
        reject(err);
      } else {
        if (
          Object.keys(data).length > 0 &&
          data.Items.length > 0 &&
          data.Items[0].kintone_refresh_token != undefined &&
          data.Items[0].kintone_refresh_token
        ) {
          resolve(data);
        } else {
          reject("error");
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: JSON.stringify(res),
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: JSON.stringify(err),
      };
    });
};

// Check login Google
const checkLoginGoogle = async (body) => {
  console.log("start check login google..", JSON.stringify(body, null, 2));
  var params = {
    TableName: "test-kintone-google-users",
    ProjectionExpression:
      "#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, google_user_email, channel_id, google_access_token",
    FilterExpression:
      "domain_name = :domain_name and app_id = :app_id and kintone_user_code = :kintone_user_code",
    ExpressionAttributeNames: {
      "#id": "id",
    },
    ExpressionAttributeValues: {
      ":domain_name": body.domain,
      ":app_id": body.appId.toString(),
      ":kintone_user_code": body.kintoneUserCode,
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.scan(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        if (
          Object.keys(data).length > 0 &&
          data.Items.length > 0 &&
          data.Items[0].google_refresh_token != undefined &&
          data.Items[0].google_refresh_token
        ) {
          var paramsGoogleUser = {
            TableName: "test-kintone-google-users",
            ProjectionExpression: "#id, google_user_email",
            FilterExpression: "google_user_email = :google_user_email",
            ExpressionAttributeNames: {
              "#id": "id",
            },
            ExpressionAttributeValues: {
              ":google_user_email": data.Items[0].google_user_email,
            },
          };
          dynamodb.scan(paramsGoogleUser, function (err, dataGoogleEmail) {
            if (err) {
              reject(err);
            } else {
              // if (Object.keys(dataGoogleEmail).length > 0 && dataGoogleEmail.Items.length > 1) {
              //   var paramsRemove = {
              //     TableName: 'test-kintone-google-users',
              //     Key: {
              //       'id': data.Items[0].id.toString(),
              //     }
              //   };
              //   dynamodb.delete(paramsRemove, function(err, data) {
              //     if (err) {
              //       sendSystemMailBaseOnDomain({ domain: body.domain, error: err, errorType: errorCode.SYS_01 });
              //       reject(err);
              //     } else {
              //       resolve({'error1': 'Exist google email'});
              //     }
              //   });
              // } else {
              if (data.Items[0].google_calendar_name != "default") {
                getAccesstoken(data.Items[0].google_refresh_token)
                  .then(function (res) {
                    const oAuth2Client = new google.auth.OAuth2(clientId);
                    oAuth2Client.setCredentials(res);
                    const calendar = google.calendar({
                      version: "v3",
                      auth: oAuth2Client,
                    });
                    calendar.calendarList.list(function (err, resp) {
                      if (err || resp.data == undefined) {
                        reject("err");
                      } else {
                        var existCalendarName = false;
                        var calendarId = "";
                        resp.data.items.forEach(function (cal) {
                          if (
                            data.Items[0].google_calendar_name == cal.summary
                          ) {
                            existCalendarName = true;
                            calendarId = cal.id;
                          }
                        });
                        if (!existCalendarName) {
                          var paramsRemove = {
                            TableName: "test-kintone-google-users",
                            Key: {
                              id: data.Items[0].id.toString(),
                            },
                          };
                          dynamodb.delete(paramsRemove, function (err, data) {
                            if (err) {
                              sendSystemMailBaseOnDomain({
                                domain: body.domain,
                                error: err,
                                errorType: errorCode.SYS_01,
                              });
                              reject(err);
                            } else {
                              resolve({ error: "Not exist name" });
                            }
                          });
                        } else {
                          var url =
                            "https://www.googleapis.com/calendar/v3/calendars/" +
                            calendarId +
                            "/events/watch";
                          var info = {
                            id: data.Items[0].channel_id,
                            type: "web_hook",
                            address: urlWatch,
                            params: {
                              ttl: 2591000,
                            },
                          };
                          var opt = {
                            method: "POST",
                            headers: {
                              Authorization:
                                "Bearer " + data.Items[0].google_access_token,
                              "Content-Type": "application/json",
                              Accept: "application/json",
                            },
                            data: JSON.stringify(info),
                            url: url,
                          };
                          axios(opt)
                            .then((response) => {
                              var params = {
                                TableName: "test-kintone-google-users",
                                Key: {
                                  id: data.Items[0].id.toString(),
                                },
                                UpdateExpression:
                                  "set google_calendar_id=:google_calendar_id",
                                ExpressionAttributeValues: {
                                  ":google_calendar_id": calendarId.toString(),
                                },
                                ReturnValues: "UPDATED_NEW",
                              };
                              dynamodb.update(params, function (err, data) {
                                if (err) {
                                  sendSystemMailBaseOnDomain({
                                    domain: body.domain,
                                    error: err,
                                    errorType: errorCode.SYS_01,
                                  });
                                  reject(err);
                                } else {
                                  resolve({ status: "success" });
                                }
                              });
                            })
                            .catch((err) => {
                              sendSyncMail({
                                domain: body.domain,
                                errorType: errorCode.SYN_08,
                                emailNoti: body.userEmail,
                              });
                              reject(err.response);
                            });
                        }
                      }
                    });
                  })
                  .catch((err) => {
                    sendSyncMail({
                      domain: body.domain,
                      errorType: errorCode.SYN_08,
                      emailNoti: body.userEmail,
                    });
                    reject(err);
                  });
              } else {
                var url =
                  "https://www.googleapis.com/calendar/v3/calendars/" +
                  data.Items[0].google_user_email +
                  "/events/watch";
                var info = {
                  id: data.Items[0].channel_id,
                  type: "web_hook",
                  address: urlWatch,
                  params: {
                    ttl: 2591000,
                  },
                };
                var opt = {
                  method: "POST",
                  headers: {
                    Authorization:
                      "Bearer " + data.Items[0].google_access_token,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  data: JSON.stringify(info),
                  url: url,
                };
                console.log("opt", JSON.stringify(opt, null, 2));
                axios(opt)
                  .then((response) => {
                    console.log("successs1");
                    resolve({ status: "success" });
                  })
                  .catch((err) => {
                    console.log("fail1");
                    console.log(err);
                    sendSyncMail({
                      domain: body.domain,
                      errorType: errorCode.SYN_08,
                      emailNoti: body.userEmail,
                    });
                    reject(err.response.statusText);
                  });
              }
              // }
            }
          });
        } else {
          reject("error");
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: JSON.stringify(res),
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: JSON.stringify(err),
      };
    });
};

// Get calendar name to show in screen index Kintone
const getCalendarName = async (body) => {
  var params = {
    TableName: "test-kintone-google-users",
    ProjectionExpression:
      "#id, domain_name, app_id, kintone_user_code, google_refresh_token, google_calendar_name, google_user_email, channel_id, google_access_token",
    FilterExpression:
      "domain_name = :domain_name and app_id = :app_id and kintone_user_code = :kintone_user_code",
    ExpressionAttributeNames: {
      "#id": "id",
    },
    ExpressionAttributeValues: {
      ":domain_name": body.domain,
      ":app_id": body.appId.toString(),
      ":kintone_user_code": body.kintoneUserCode,
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.scan(params, function (err, data) {
      if (err) {
        sendSystemMailBaseOnDomain({
          domain: body.domain,
          error: err,
          errorType: errorCode.SYS_01,
        });
        reject(err);
      } else {
        if (
          Object.keys(data).length > 0 &&
          data.Items.length > 0 &&
          data.Items[0].google_refresh_token != undefined &&
          data.Items[0].google_refresh_token
        ) {
          if (data.Items[0].google_calendar_name != "default") {
            resolve({ data: data.Items[0].google_calendar_name });
          } else {
            resolve({ data: "" });
          }
        } else {
          resolve({ data: "" });
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: JSON.stringify(res),
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: JSON.stringify(err),
      };
    });
};

// Get all account which logged in by domain and app_id
const getLoggedGoogle = async (body) => {
  var params = {
    TableName: "test-kintone-google-users",
    ProjectionExpression:
      "#id, domain_name, app_id, kintone_user_code, kintone_user_name, google_user_email, google_calendar_name, kintone_refresh_token",
    FilterExpression: "domain_name = :domain_name and app_id = :app_id",
    ExpressionAttributeNames: {
      "#id": "id",
    },
    ExpressionAttributeValues: {
      ":domain_name": body.domain,
      ":app_id": body.appId.toString(),
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.scan(params, function (err, data) {
      if (err) {
        sendSystemMailBaseOnDomain({
          domain: body.domain,
          error: err,
          errorType: errorCode.SYS_01,
        });
        reject(err);
      } else {
        if (Object.keys(data).length > 0 && data.Items.length > 0) {
          resolve(data);
        } else {
          reject("error");
        }
      }
    });
  })
    .then(function (res) {
      return {
        statusCode: 200,
        body: JSON.stringify(res),
      };
    })
    .catch(function (err) {
      return {
        statusCode: 500,
        body: JSON.stringify(err),
      };
    });
};

// Get event in Google Calendar by event_id
const getEvent = (auth, calendarId, eventId) => {
  return new Promise(function (resolve, reject) {
    const calendar = google.calendar({ version: "v3", auth });
    calendar.events.get(
      {
        auth: auth,
        calendarId: calendarId,
        eventId: eventId,
      },
      function (err, res) {
        if (err) {
          reject(err);
        } else {
          if (res.data) {
            resolve(res.data);
          } else {
            reject();
          }
        }
      }
    );
  });
};

// Get event in Google Calendar by eventKintoneId
const getEventByKintoneId = (auth, calendarId, eventKintoneId) => {
  return new Promise(function (resolve, reject) {
    const calendar = google.calendar({ version: "v3", auth });
    calendar.events.list(
      {
        calendarId: calendarId,
        privateExtendedProperty: `kintoneRecordId=${eventKintoneId}`,
      },
      function (err, res) {
        if (err) {
          reject(err);
        } else {
          if (res.data && res.data.items.length > 0) {
            resolve(res.data.items[0]);
          } else {
            reject();
          }
        }
      }
    );
  });
};

// Insert an event in Google Calendar
// const insertEvent = (auth, calendarId, event) => {
//   console.log('insert google event...');

//   return new Promise(function(resolve, reject) {
//     const calendar = google.calendar({ version: 'v3', auth });
//     console.log('check loop');
//     console.log('event ',JSON.stringify(event, null, 2))
//     console.log('google calendarId: ',calendarId);
//     calendar.events.insert({
//       auth: auth,
//       calendarId: calendarId,
//       resource: event,
//     }, function(err, res) {
//       console.log('err');
//       if (err) {
//         reject(err.data);
//       } else {
//         resolve(res.data);
//       }
//     });
//   });
// };

const insertEvent = (auth, calendarId, event) => {
  console.log("insert google event...");

  return new Promise(function (resolve, reject) {
    const calendar = google.calendar({ version: "v3", auth });
    console.log("check loop");
    console.log("event ", JSON.stringify(event, null, 2));
    console.log("google calendarId: ", calendarId);
    calendar.events.insert(
      {
        auth: auth,
        calendarId: calendarId,
        resource: event,
      },
      function (err, res) {
        console.log("err");
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      }
    );
  });
};

// Update an event in Google Calendar
const updateEvent = (auth, calendarId, eventId, event) => {
  return new Promise(function (resolve, reject) {
    const calendar = google.calendar({ version: "v3", auth });
    calendar.events.update(
      {
        auth: auth,
        eventId: eventId,
        calendarId: calendarId,
        resource: event,
      },
      function (err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      }
    );
  });
};

// Delete an event in Google Calendar
const deleteEvent = (auth, calendarId, eventId) => {
  return new Promise(function (resolve, reject) {
    const calendar = google.calendar({ version: "v3", auth });
    calendar.events.delete(
      {
        auth: auth,
        eventId: eventId,
        calendarId: calendarId,
      },
      function (err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      }
    );
  });
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

// Get accessToken in Kintone by refreshToken
const getAccesstokenKintone = (domain, kintoneClientId, kintoneClientSecret, kintoneRefreshToken) => {
  return new Promise(function(resolve, reject) {
    const data = {
      client_id: kintoneClientId,
      client_secret: kintoneClientSecret,
      refresh_token: kintoneRefreshToken,
      grant_type: 'refresh_token'
    };
    const options = {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: qs.stringify(data),
      url: 'https://' + domain + '/oauth2/token'
    };
    console.log("getAcceesstokenkintone",options)
    axios(options).then(response => {
      console.log(options)
      resolve(response.data);
    }).catch(function (error) {
      reject(error);
    });
  });
};

// Get list events in Google calendar just updated to sync to Kintone
const listEvents = async (auth, config) => {
  var domain = config.domain_name;

  let check = await checkAuth(domain, pluginID);
  console.log("check auth: ", check);
  if (!check) {
    console.log("trail end");
    return {
      statusCode: 200,
      body: "end time",
    };
  }

  var appId = config.app_id;
  console.log("list event appid:", appId);
  var kintoneUserId = config.kintone_user_id;
  var kintoneUserCode = config.kintone_user_code;
  var kintoneUserName = config.kintone_user_name;
  var kintoneRefreshToken = config.kintone_refresh_token;
  var timeZoneUser =
    config.time_zone_user != undefined ? config.time_zone_user : timeZone;
  var params = {
    TableName: "test-kintone-google-settings",
    Key: {
      domain_name: domain,
      app_id: appId.toString(),
    },
  };
  return new Promise(function (resolve, reject) {
    dynamodb.get(params, async function (err, dataDb) {
      if (err) {
        reject(err);
      } else {
        if (Object.keys(dataDb).length > 0) {
          const calendar = google.calendar({ version: "v3", auth });
          var lastTime = new Date();
          var mappingFields = dataDb.Item.mapping_fields;
          var kintoneClientId = dataDb.Item.kintone_client_id;
          var kintoneClientSecret = dataDb.Item.kintone_client_secret;
          var calendarPlugin = dataDb.Item.calendar_plugin;
          var userInfo = dataDb.Item.user_info;
          var calendarId = "primary";
          if (config.google_calendar_name != "default") {
            calendarId = config.google_calendar_id;
          }
          var dataLogin = await getAllUserLogin(domain, appId);
          lastTime.setMinutes(
            lastTime.getMinutes(),
            lastTime.getSeconds() - 10
          );
          console.log(lastTime.toISOString()); //debug
          getAccesstoken(config.google_refresh_token)
            .then(function (res) {
              var accessToken = res;

              var calendarId = "";
              if (
                config.google_calendar_id != undefined &&
                config.google_calendar_id
              ) {
                calendarId = config.google_calendar_id;
              } else {
                calendarId = config.google_user_email;
              }

              var url =
                "https://www.googleapis.com/calendar/v3/calendars/" +
                calendarId +
                "/events?singleEvents=true&showDeleted=true";

              var syncToken = config.next_sync_token;
              var opt = {
                method: "GET",
                headers: {
                  Authorization: "Bearer " + accessToken.access_token,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                url: url + `&syncToken=${syncToken}`,
              };
              console.log("opt", opt)
              axios(opt)  
                .then((response) => {
                  let next_sync_token = response.data.nextSyncToken;
                  let update_param = {
                    TableName: "test-kintone-google-users",
                    Key: {
                      id: config.id.toString(),
                    },
                    UpdateExpression: "set next_sync_token = :nextSyncToken",
                    ExpressionAttributeValues: {
                      ":nextSyncToken": next_sync_token,
                    },
                    ReturnValues: "UPDATED_NEW",
                  };
                  console.log("update param", update_param);
                  dynamodb.update(update_param, function (err, dataUser) {
                    if (err) {
                      console.log("update error", err)
                      sendSystemMailBaseOnDomain({
                        domain: config.domain_name,
                        error: err,
                        errorType: errorCode.SYS_01,
                      });
                      reject(err);
                    } else {
                      console.log("update成功");
                    }
                  });

                  let events = response.data.items;
                  console.log("all event", JSON.stringify(events));
                  console.log("event length: ", events.length);
                  if (events.length) {
                    var arrRecordDelete = [];
                    var arrRecordUpdate = [];
                    var arrRecordInsert = [];
                    console.log("domain",domain)
                    console.log("dataDb.Item kintone",dataDb.Item)
                    
                    getAccesstokenKintone(
                      domain,
                      kintoneClientId,
                      kintoneClientSecret,
                      kintoneRefreshToken
                    )
                      .then(async (response) => {
                        var kintoneAccessToken = response.access_token;
                        var arrRepeat = [];
                        var titleDeleteError = "";
                        for (
                          let indexEvent = 0;
                          indexEvent < events.length;
                          indexEvent++
                        ) {
                          if (
                            events[indexEvent].recurringEventId != undefined
                          ) {
                            if (
                              arrRepeat[events[indexEvent].recurringEventId] ==
                              undefined
                            ) {
                              arrRepeat[
                                events[indexEvent].recurringEventId
                              ] = uuid();
                            }
                          }
                        }
                        try {
                          var arrPromise = [];
                          // sleep(3000).then(() => {
                          for (
                            let indexEvent = 0;
                            indexEvent < events.length;
                            indexEvent++
                          ) {
                            console.log(
                              "event Gooogle",
                              JSON.stringify(events[indexEvent])
                            );
                            console.log(
                              "recurringEventId",
                              events[indexEvent].recurringEventId
                            );
                            if (
                              events[indexEvent].creator &&
                              events[indexEvent].creator.email ==
                                config.google_user_email &&
                              !events[indexEvent].recurringEventId
                            ) {
                              let syncEvent = syncGoogleToKintone(
                                domain,
                                appId,
                                kintoneAccessToken,
                                events,
                                indexEvent,
                                mappingFields,
                                kintoneUserId,
                                kintoneUserCode,
                                kintoneUserName,
                                calendarPlugin,
                                arrRepeat,
                                dataLogin,
                                timeZoneUser,
                                userInfo
                              )
                                .then((data) => {
                                  if (data.delete != undefined) {
                                    arrRecordDelete.push(data.delete.id);
                                    titleDeleteError = data.delete.title;
                                  } else if (data.update != undefined) {
                                    arrRecordUpdate.push(data.update);
                                  } else if (data.insert != undefined) {
                                    arrRecordInsert.push(data.insert);
                                  }
                                })
                                .catch((err) => {
                                  console.log(err);
                                });
                              arrPromise.push(syncEvent);
                            }
                          }
                          Promise.all(arrPromise)
                            .then(async () => {
                              getAccesstokenKintone(
                                domain,
                                kintoneClientId,
                                kintoneClientSecret,
                                kintoneRefreshToken
                              ).then(async (res) => {
                                var kintoneAccessToken = res.access_token;
                                if (arrRecordUpdate.length > 0) {
                                  for (let index = 1; index < 2; index++) {
                                    let arrUpdate = arrRecordUpdate.filter(
                                      (element, idx) =>
                                        idx >= 50 * (index - 1) &&
                                        idx < 50 * index
                                    );
                                    var records = {
                                      app: appId,
                                      records: arrUpdate,
                                    };
                                    console.log(
                                      "arr update",
                                      JSON.stringify(arrUpdate)
                                    );
                                    var headers = {
                                      Authorization: `Bearer ${kintoneAccessToken}`,
                                      "Content-Type": "application/json",
                                      Accept: "application/json",
                                    };
                                    var options = {
                                      url:
                                        "https://" +
                                        domain +
                                        "/k/v1/records.json",
                                      method: "PUT",
                                      headers: headers,
                                      json: true,
                                      body: records,
                                    };
                                    await new Promise(function (res, rej) {
                                      request(
                                        options,
                                        function (error, response, body) {
                                          console.log(JSON.stringify(body));
                                          if (
                                            !error &&
                                            body.records != undefined
                                          ) {
                                            res(body);
                                          } else {
                                            console.log("Update fail", error);
                                            sendSyncMail({
                                              domain,
                                              errorType: errorCode.SYN_02,
                                              emailNoti: dataDb.Item.user_email,
                                              subject:
                                                arrRecordUpdate[0].record[
                                                  [mappingFields.summary]
                                                ].value,
                                            });
                                            rej(error);
                                          }
                                        }
                                      );
                                    }).catch((err) => {
                                      reject(err);
                                    });
                                    if (
                                      Math.floor(
                                        arrRecordUpdate.length / (50 * index)
                                      ) == 0 ||
                                      index * 50 == arrRecordUpdate.length
                                    ) {
                                      break;
                                    }
                                  }
                                }
                                if (arrRecordInsert.length > 0) {
                                  for (let index = 1; index < 2; index++) {
                                    let arrInsert = arrRecordInsert.filter(
                                      (element, idx) =>
                                        idx >= 50 * (index - 1) &&
                                        idx < 50 * index
                                    );
                                    var records = {
                                      app: appId,
                                      records: arrInsert,
                                    };
                                    var headers = {
                                      Authorization: `Bearer ${kintoneAccessToken}`,
                                      "Content-Type": "application/json",
                                      Accept: "application/json",
                                    };
                                    var options = {
                                      url:
                                        "https://" +
                                        domain +
                                        "/k/v1/records.json",
                                      method: "POST",
                                      headers: headers,
                                      json: true,
                                      body: records,
                                    };
                                    console.log(
                                      "insert",
                                      JSON.stringify(records)
                                    );
                                    await new Promise(function (res, rej) {
                                      request(
                                        options,
                                        async function (error, response, body) {
                                          if (
                                            !error &&
                                            body.ids != undefined &&
                                            body.ids.length > 0
                                          ) {
                                            var ids = body.ids;
                                            for (
                                              let index = 0;
                                              index < ids.length;
                                              index++
                                            ) {
                                              var event =
                                                arrRecordInsert[index][
                                                  "eventGoogle"
                                                ];
                                              event["extendedProperties"] = {
                                                private: {
                                                  kintoneRecordId: ids[index],
                                                },
                                              };
                                              await updateEvent(
                                                auth,
                                                calendarId,
                                                event.id,
                                                event
                                              )
                                                .then(function (res) {
                                                  console.log(
                                                    "update id",
                                                    index
                                                  );
                                                  console.log(res);
                                                })
                                                .catch((err) => {
                                                  console.log("err", err);
                                                });
                                            }
                                            console.log("insert success");
                                            res(body);
                                          } else {
                                            sendSyncMail({
                                              domain,
                                              errorType: errorCode.SYN_01,
                                              emailNoti: dataDb.Item.user_email,
                                              subject:
                                                arrRecordInsert[0][
                                                  [mappingFields.summary]
                                                ].value,
                                            });
                                            console.log("insert Error", error);
                                            rej(error);
                                          }
                                        }
                                      );
                                    }).catch((err) => {
                                      reject(err);
                                    });
                                    if (
                                      Math.floor(
                                        arrRecordInsert.length / (50 * index)
                                      ) == 0 ||
                                      index * 50 == arrRecordInsert.length
                                    ) {
                                      break;
                                    }
                                  }
                                }
                                if (arrRecordDelete.length > 0) {
                                  for (let index = 1; index < 2; index++) {
                                    let arrDelete = arrRecordDelete.filter(
                                      (element, idx) =>
                                        idx >= 50 * (index - 1) &&
                                        idx < 50 * index
                                    );
                                    console.log(
                                      "delete Ev",
                                      JSON.stringify(arrDelete)
                                    );
                                    var query = {
                                      app: appId,
                                      ids: arrDelete,
                                    };
                                    var headers = {
                                      Authorization: `Bearer ${kintoneAccessToken}`,
                                      "Content-Type":
                                        "application/x-www-form-urlencoded",
                                    };
                                    var options = {
                                      url:
                                        "https://" +
                                        domain +
                                        "/k/v1/records.json",
                                      method: "DELETE",
                                      headers: headers,
                                      qs: query,
                                    };
                                    await new Promise(function (res, rej) {
                                      request(
                                        options,
                                        function (error, response, body) {
                                          if (!error) {
                                            console.log(
                                              "detele success",
                                              JSON.stringify(body)
                                            );
                                            res(body);
                                          } else {
                                            sendSyncMail({
                                              domain,
                                              errorType: errorCode.SYN_03,
                                              emailNoti: dataDb.Item.user_email,
                                              subject: titleDeleteError,
                                            });
                                            console.log("delete Error", error);
                                            rej(error);
                                          }
                                        }
                                      );
                                    }).catch((err) => {
                                      reject(err);
                                    });
                                    if (
                                      Math.floor(
                                        arrRecordDelete.length / (50 * index)
                                      ) == 0 ||
                                      index * 50 == arrRecordDelete.length
                                    ) {
                                      break;
                                    }
                                  }
                                }
                                resolve();
                              });
                            })
                            .catch((err) => {
                              reject(err);
                            });
                          // });
                        } catch (err) {
                          reject();
                        }
                      })
                      .catch((err) => {
                        console.log("kintone同期error", err)
                        sendSyncMail({
                          domain,
                          errorType: errorCode.SYN_07,
                          emailNoti: dataDb.Item.user_email,
                        });
                        console.log(err);
                        reject(err);
                      });
                  } else {
                    console.log("No upcoming events found.");
                    reject();
                  }
                })
                .catch((err) => {
                  console.log(err);
                  sendSyncMail({
                    domain,
                    errorType: errorCode.SYN_08,
                    emailNoti: dataDb.Item.user_email,
                  });
                  reject(err);
                });
            })
            .catch(function (err) {
              sendSystemMailBaseOnDomain({
                domain: config.domain_name,
                error: err,
                errorType: errorCode.SYS_01,
              });
            });
        } else {
          reject("err");
        }
      }
    });
  });
};

// Sync event from Google Calendar to Kintone
const syncGoogleToKintone = async (
  domain,
  appId,
  kintoneAccessToken,
  events,
  indexEvent,
  mappingFields,
  kintoneUserId,
  kintoneUserCode,
  kintoneUserName,
  calendarPlugin,
  arrRepeat,
  dataLogin,
  timeZoneUser,
  userInfo
) => {
  try {
    console.log("id", events[indexEvent].id);
    var eventGoogle = events[indexEvent];
    var summary = eventGoogle.summary != undefined ? eventGoogle.summary : "";
    var kintoneId = "";
    if (
      eventGoogle.extendedProperties &&
      eventGoogle.extendedProperties.private &&
      eventGoogle.extendedProperties.private.kintoneRecordId
    ) {
      kintoneId = eventGoogle.extendedProperties.private.kintoneRecordId;
    }
    var eventData = null;
    if (kintoneId) {
      console.log("kintone Id", kintoneId);
      eventData = await getEventKintoneById(
        domain,
        appId,
        kintoneId,
        kintoneAccessToken
      );

      console.log(eventData);
    }
    if (eventGoogle.status == "cancelled") {
      if (kintoneId) {
        return {
          delete: {
            id: kintoneId,
            title: eventData
              ? eventData.record[mappingFields.summary].value
              : summary,
          },
        };
      } else {
        return {};
      }
    } else {
      var startTimeGoogle;
      var endTimeGoogle;
      var startTimeKintone;
      var endTimeKintone;
      var showAllDay = false;
      var attendees = [];
      if (eventGoogle.start.date) {
        var endDate = new Date(eventGoogle.end.date);

        if (calendarPlugin == "default" || calendarPlugin == "koyomi") {
          endDate.setDate(endDate.getDate() - 1);
        }

        startTimeGoogle = moment
          .tz(eventGoogle.start.date.toString() + " 00:00:00", timeZoneUser)
          .format();
        endTimeGoogle = moment
          .tz(formatDateISO8601(endDate).toString() + " 00:00:00", timeZoneUser)
          .format();

        showAllDay = mappingFields.showAllDay != undefined ? true : false;
        if (eventData && eventData.record) {
          startTimeKintone = formatDateISO8601(
            new Date(
              new Date(
                eventData.record[mappingFields.start].value
              ).toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
            )
          );
          if (eventData.record[mappingFields.end].value) {
            endTimeKintone = formatDateISO8601(
              new Date(
                new Date(
                  eventData.record[mappingFields.end].value
                ).toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
              )
            );
          } else {
            endTimeKintone = formatDateISO8601(endDate);
          }
        }
      } else {
        startTimeGoogle = eventGoogle.start.dateTime;
        endTimeGoogle = eventGoogle.end.dateTime;

        if (eventData && eventData.record) {
          startTimeKintone = formatISO8601(
            new Date(eventData.record[mappingFields.start].value)
          );
          if (eventData.record[mappingFields.end].value) {
            endTimeKintone = formatISO8601(
              new Date(eventData.record[mappingFields.end].value)
            );
          } else {
            // endTimeKintone = endTimeGoogle;
            endTimeKintone = formatISO8601(new Date(endTimeGoogle));
          }
        }
      }
      var record = {
        [mappingFields.summary]: {
          value: summary,
        },
        [mappingFields.start]: {
          value: startTimeGoogle,
        },
      };

      if (mappingFields.description != undefined) {
        if (eventGoogle.description != undefined) {
          record[mappingFields.description] = {
            value: eventGoogle.description,
          };
        } else {
          record[mappingFields.description] = {
            value: "",
          };
        }
      }

      if (mappingFields.location != undefined) {
        if (eventGoogle.location != undefined) {
          record[mappingFields.location] = {
            value: eventGoogle.location,
          };
        } else {
          record[mappingFields.location] = {
            value: "",
          };
        }
      }
      var dataMember = await getAttendees(eventGoogle, dataLogin);
      if (mappingFields.membersField) {
        //koyomi handle
        let found = dataLogin.find(
          (x) => x.google_user_email == eventGoogle.creator.email
        );
        console.log("found:", found);
        record[mappingFields.membersField] = {
          value: [
            {
              code: found.kintone_user_code,
              name: found.kintone_user_name,
            },
          ],
        };

        if (mappingFields.attendees != undefined) {
          attendees = dataMember.attendees;
          record[mappingFields.membersField].value = record[
            mappingFields.membersField
          ].value.concat(attendees);

          //add koyomi user to attend
          attendees.unshift({
            code: found.kintone_user_code,
            name: found.kintone_user_name,
          });
        }
      } else {
        // not koyomi
        if (mappingFields.attendees != undefined) {
          attendees = dataMember.attendees;
          record[mappingFields.attendees] = {
            value: attendees,
          };
        }
      }

      if (calendarPlugin == "koyomi") {
        record[mappingFields.membersCode] = { value: dataMember.membersCode };
      }

      console.log("mapping Fiels: ", JSON.stringify(mappingFields, null, 2));
      console.log("showAllDay: ", showAllDay);

      if (mappingFields.showAllDay != undefined && !showAllDay) {
        record[mappingFields.showAllDay] = {
          value: [],
        };
        console.log("flag");
        if (calendarPlugin == "koyomi") {
          record[mappingFields.type] = {
            value: mappingFields.optionsType[0],
          };
        }
      } else if (showAllDay) {
        if (
          calendarPlugin == "koyomi" &&
          getDistanceTwoDates(
            new Date(eventGoogle.start.date),
            new Date(eventGoogle.end.date)
          ) >= 1 &&
          eventGoogle.recurringEventId == undefined
        ) {
          record[mappingFields.type] = {
            value: mappingFields.optionsType[1],
          };
        } else {
          console.log("val all day", mappingFields.valAllDay);
          record[mappingFields.showAllDay] = {
            value: [mappingFields.valAllDay],
          };
        }
      }

      if (calendarPlugin == "koyomi") {
        if (
          mappingFields.attendees != undefined &&
          dataMember.attendees.length == 0
        ) {
          record[mappingFields.attendees] = {
            value: [
              {
                code: kintoneUserCode,
                name: kintoneUserName,
              },
            ],
          };
        }
        if (!dataMember.membersCode) {
          record[mappingFields.membersCode] = {
            value: kintoneUserId,
          };
        }
      } else {
        if (userInfo && !eventData) {
          if (userInfo.type === "USER_SELECT") {
            record[userInfo.field] = {
              value: [
                {
                  code: kintoneUserCode,
                  name: kintoneUserName,
                },
              ],
            };
          }
        }
      }
      console.log("event data: ", eventData);
      if (
        eventData &&
        eventData.record &&
        checkUpdateTime(eventData.record, eventGoogle)
      ) {
        if (
          (eventGoogle.start.dateTime &&
            formatISO8601(new Date(startTimeGoogle)) != startTimeKintone) ||
          (eventGoogle.end.dateTime &&
            formatISO8601(new Date(endTimeGoogle)) != endTimeKintone) ||
          (eventGoogle.start.date &&
            formatDateISO8601(new Date(eventGoogle.start.date)) !=
              startTimeKintone) ||
          (eventGoogle.end.date &&
            formatDateISO8601(endDate) != endTimeKintone) ||
          ((calendarPlugin == "default" ||
            calendarPlugin == "calendar-plus" ||
            calendarPlugin == "none-calendar" ||
            eventData.record[mappingFields.type].value !=
              mappingFields.optionsType[1]) &&
            eventGoogle.end.date &&
            mappingFields.showAllDay != undefined &&
            eventData.record[mappingFields.showAllDay] != undefined &&
            eventData.record[mappingFields.showAllDay].value.length == 0) ||
          summary != eventData.record[mappingFields.summary].value ||
          checkChangeDescription(
            events,
            indexEvent,
            eventData,
            mappingFields
          ) ||
          checkChangeLocation(events, indexEvent, eventData, mappingFields) ||
          checkChangeAttendees(eventData, mappingFields, attendees)
        ) {
          console.log(
            "startTime check",
            eventGoogle.start.dateTime &&
              formatISO8601(new Date(startTimeGoogle)) != startTimeKintone
          );
          console.log(
            "end time check",
            eventGoogle.end.dateTime &&
              formatISO8601(new Date(endTimeGoogle)) != endTimeKintone
          );
          console.log(
            "start check",
            eventGoogle.start.date &&
              formatDateISO8601(new Date(eventGoogle.start.date)) !=
                startTimeKintone
          );
          console.log(
            "end check",
            eventGoogle.end.date && formatDateISO8601(endDate) != endTimeKintone
          );
          console.log(
            "sumary check",
            summary != eventData.record[mappingFields.summary].value
          );
          console.log(
            "desciption check",
            checkChangeDescription(events, indexEvent, eventData, mappingFields)
          );
          console.log(
            "loacation check",
            checkChangeLocation(events, indexEvent, eventData, mappingFields)
          );
          console.log(
            "attten check ",
            checkChangeAttendees(eventData, mappingFields, attendees)
          );

          if (
            eventData.record[mappingFields.end].value ||
            eventGoogle.start.date != undefined
          ) {
            record[mappingFields.end] = {
              value: endTimeGoogle,
            };
          }

          var recordData = {
            id: eventData.record.$id.value,
            record: record,
          };

          return { update: recordData };
        } else {
          return {};
        }
      } else {
        record[mappingFields.end] = {
          value: endTimeGoogle,
        };

        console.log("google -> koyomi test:..");
        console.log("calendar plugin", calendarPlugin);
        console.log("event google: ", JSON.stringify(eventGoogle, null, 2));
        if (
          calendarPlugin == "koyomi" &&
          eventGoogle.recurringEventId != undefined
        ) {
          record[mappingFields.repeatKey] = {
            value: arrRepeat[eventGoogle.recurringEventId],
          };
          record[mappingFields.type] = {
            value: mappingFields.optionsType[2],
          };
        }
        record["eventGoogle"] = eventGoogle;

        return { insert: record };
      }
    }
  } catch (err) {
    throw err;
  }
};
// const syncGoogleToKintone = (domain, appId, kintoneAccessToken, events, indexEvent, mappingFields, kintoneUserId, kintoneUserCode, kintoneUserName, calendarPlugin, arrRepeat, dataLogin, timeZoneUser) => {
//   return new Promise(async (resolve, reject) => {
//     try {
//       console.log('id', events[indexEvent].id);
//       var eventGoogle = events[indexEvent];
//       var summary = eventGoogle.summary != undefined ? eventGoogle.summary : '';
//       var kintoneId = '';
//       if (eventGoogle.extendedProperties && eventGoogle.extendedProperties.private && eventGoogle.extendedProperties.private.kintoneRecordId) {
//         kintoneId = eventGoogle.extendedProperties.private.kintoneRecordId;
//       }
//       var eventData = null;
//       if (kintoneId) {
//         console.log('kintone Id', kintoneId);
//         await getEventKintoneById(domain, appId, kintoneId, kintoneAccessToken).then((data) => {
//           eventData = data;
//         }).catch((err) => {
//           reject();
//         });
//         console.log(eventData);
//       }
//       if (eventGoogle.status == 'cancelled') {
//         if (kintoneId) {
//           resolve({'delete': {id: kintoneId, 'title': eventData ? eventData.record[mappingFields.summary].value : summary}});
//         } else {
//           reject();
//         }
//       } else {
//         var startTimeGoogle;
//         var endTimeGoogle;
//         var startTimeKintone;
//         var endTimeKintone;
//         var showAllDay = false;
//         var attendees = [];
//         if (eventGoogle.start.date) {
//           var endDate = new Date(eventGoogle.end.date);

//           if (calendarPlugin == 'default' || calendarPlugin == 'koyomi' ){
//             endDate.setDate(endDate.getDate() - 1);
//           }

//           // if (calendarPlugin == 'default') {
//           //   // startTimeGoogle = eventGoogle.start.date.toString() + 'T00:00:00+09:00';
//           //   // console.log('endDate: ', eventGoogle.end.date)
//           //   // endTimeGoogle = formatDateISO8601(endDate).toString() + 'T23:59:59+09:00';
//           //   startTimeGoogle = moment.tz(eventGoogle.start.date.toString() + ' 00:00:00', timeZoneUser).format();
//           //   endTimeGoogle = moment.tz(formatDateISO8601(endDate).toString() + ' 00:00:00', timeZoneUser).format();
//           // } else  {
//           //   startTimeGoogle = moment.tz(eventGoogle.start.date.toString() + ' 00:00:00', timeZoneUser).format();
//           //   endTimeGoogle = moment.tz(formatDateISO8601(endDate).toString() + ' 00:00:00', timeZoneUser).format();
//           // }

//           // if (calendarPlugin == 'default' || calendarPlugin == 'koyomi'){
//           //   startTimeGoogle = moment.tz(eventGoogle.start.date.toString() + ' 00:00:00', timeZoneUser).format();
//           //   endTimeGoogle = moment.tz(formatDateISO8601(endDate).toString() + ' 00:00:00', timeZoneUser).format();
//           // }else{
//             startTimeGoogle = moment.tz(eventGoogle.start.date.toString() + ' 00:00:00', timeZoneUser).format();
//             endTimeGoogle = moment.tz(formatDateISO8601(endDate).toString() + ' 00:00:00', timeZoneUser).format();
//           //}
//           showAllDay = mappingFields.showAllDay != undefined ? true : false;
//           if (eventData) {
//             startTimeKintone = formatDateISO8601(new Date(new Date(eventData.record[mappingFields.start].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"})));
//             endTimeKintone = formatDateISO8601(new Date(new Date(eventData.record[mappingFields.end].value).toLocaleString("en-US", {timeZone: "Asia/Tokyo"})));
//           }
//         } else {
//           startTimeGoogle = eventGoogle.start.dateTime;
//           endTimeGoogle = eventGoogle.end.dateTime;
//           if (eventData) {
//             startTimeKintone = formatISO8601(new Date(eventData.record[mappingFields.start].value));
//             if (eventData.record[mappingFields.end].value) {
//               endTimeKintone = formatISO8601(new Date(eventData.record[mappingFields.end].value));
//             } else {
//               endTimeKintone = endTimeGoogle;
//             }
//           }
//         }
//         var record = {
//           [mappingFields.summary]: {
//             'value': summary
//           },
//           [mappingFields.start]: {
//             'value': startTimeGoogle
//           }
//         };

//         if (mappingFields.description != undefined) {
//           if (eventGoogle.description != undefined) {
//             record[mappingFields.description] = {
//               'value' : eventGoogle.description
//             };
//           } else {
//             record[mappingFields.description] = {
//               'value' : ''
//             };
//           }
//         }

//         if (mappingFields.location != undefined) {
//           if (eventGoogle.location != undefined) {
//             record[mappingFields.location] = {
//               'value' : eventGoogle.location
//             };
//           } else {
//             record[mappingFields.location] = {
//               'value' : ''
//             };
//           }
//         }
//         var dataMember = await getAttendees(eventGoogle, dataLogin);
//         // if (mappingFields.attendees != undefined) {
//         //   attendees = dataMember.attendees;
//         //   record[mappingFields.attendees] = {
//         //     'value' : attendees
//         //   };
//         // }

//         if (mappingFields.membersField){ //koyomi handle
//           let found = dataLogin.find(x => x.google_user_email == eventGoogle.creator.email);
//           console.log('found:' , found);
//           record[mappingFields.membersField] = {
//             'value' : [
//               {
//                 'code': found.kintone_user_code,
//                 'name': found.kintone_user_name
//               }
//             ]
//           };

//           if (mappingFields.attendees != undefined) {
//             attendees = dataMember.attendees;

//             record[mappingFields.membersField].value = record[mappingFields.membersField].value.concat(attendees)
//           }
//         }else{ // not koyomi
//           if (mappingFields.attendees != undefined) {
//             attendees = dataMember.attendees;
//             record[mappingFields.attendees] = {
//               'value' : attendees
//             };
//           }
//         }

//         if (calendarPlugin == 'koyomi') {
//           record[mappingFields.membersCode] = {"value": dataMember.membersCode};
//         }

//         if (mappingFields.showAllDay != undefined && !showAllDay) {
//           record[mappingFields.showAllDay] = {
//             'value' : []
//           };
//         } else if (showAllDay) {
//           if (
//             calendarPlugin == 'koyomi' &&
//             getDistanceTwoDates(new Date(eventGoogle.start.date), new Date(eventGoogle.end.date)) > 1 &&
//             eventGoogle.recurringEventId == undefined
//           ) {
//             record[mappingFields.type] = {
//               'value': mappingFields.optionsType[1]
//             }
//           } else {
//             console.log('val all day', mappingFields.valAllDay);
//             record[mappingFields.showAllDay] = {
//               'value' : [mappingFields.valAllDay]
//             };
//           }
//         }

//         if (calendarPlugin == 'koyomi') {
//           if (mappingFields.attendees != undefined && dataMember.attendees.length == 0) {
//             record[mappingFields.attendees] = {
//               'value': [{
//                 'code': kintoneUserCode,
//                 'name': kintoneUserName
//               }]
//             };
//           }
//           if (!dataMember.membersCode) {
//             record[mappingFields.membersCode] = {
//               'value': kintoneUserId
//             };
//           }
//         }

//         console.log('event data: ', eventData)
//         if (eventData) {
//           if (
//             (eventGoogle.start.dateTime && formatISO8601(new Date(startTimeGoogle)) != startTimeKintone) ||
//             (eventGoogle.end.dateTime && formatISO8601(new Date(endTimeGoogle)) != endTimeKintone) ||
//             (eventGoogle.start.date && formatDateISO8601(new Date(eventGoogle.start.date)) != startTimeKintone) ||
//             (eventGoogle.end.date && formatDateISO8601(endDate) != endTimeKintone) ||
//             (
//               (calendarPlugin == 'default' || calendarPlugin == 'calendar-plus' || calendarPlugin == 'none-calendar'|| eventData.record[mappingFields.type].value != mappingFields.optionsType[1]) &&
//               eventGoogle.end.date &&
//               mappingFields.showAllDay != undefined &&
//               eventData.record[mappingFields.showAllDay] != undefined &&
//               eventData.record[mappingFields.showAllDay].value.length == 0
//             ) ||
//             summary != eventData.record[mappingFields.summary].value ||
//             checkChangeDescription(events, indexEvent, eventData, mappingFields) ||
//             checkChangeLocation(events, indexEvent, eventData, mappingFields) ||
//             checkChangeAttendees(eventData, mappingFields, attendees)
//           ) {
//             if (eventData.record[mappingFields.end].value || eventGoogle.start.date != undefined) {
//               record[mappingFields.end] = {
//                 'value': endTimeGoogle
//               };
//             }

//             var recordData = {
//               'id': eventData.record.$id.value,
//               'record': record
//             };

//             resolve({'update': recordData});
//           } else {
//             reject();
//           }
//         } else {
//           record[mappingFields.end] = {
//             'value': endTimeGoogle
//           };

//           console.log('google -> koyomi test:..');
//           console.log('calendar plugin', calendarPlugin);
//           console.log('event google: ',JSON.stringify(eventGoogle, null, 2))
//           if (calendarPlugin == 'koyomi' && eventGoogle.recurringEventId != undefined) {
//             record[mappingFields.repeatKey] = {
//               'value': arrRepeat[eventGoogle.recurringEventId]
//             };
//             record[mappingFields.type] = {
//               'value': mappingFields.optionsType[2]
//             }
//           }
//           record['eventGoogle'] = eventGoogle;

//           resolve({'insert': record});
//         }
//       }
//     } catch (err) {
//       reject();
//     }
//   });
// };

const getEventKintoneById = async (
  domain,
  appId,
  kintoneId,
  kintoneAccessToken
) => {
  return new Promise(function (resolve, reject) {
    var headers = { Authorization: `Bearer ${kintoneAccessToken}` };
    var options = {
      url:
        "https://" + domain + `/k/v1/record.json?app=${appId}&id=${kintoneId}`,
      method: "GET",
      headers: headers,
    };
    request(options, async (error, response, body) => {
      if (!error) {
        resolve(JSON.parse(body));
      } else {
        reject();
      }
    });
  });
};

const getAllUserLogin = async (domain, appId) => {
  return new Promise(function (resolve, reject) {
    var params = {
      TableName: "test-kintone-google-users",
      ProjectionExpression:
        "#id, domain_name, app_id, kintone_user_id, kintone_user_code, kintone_user_name, google_user_email, google_calendar_name",
      FilterExpression: "domain_name = :domain_name and app_id = :app_id",
      ExpressionAttributeNames: {
        "#id": "id",
      },
      ExpressionAttributeValues: {
        ":domain_name": domain,
        ":app_id": appId.toString(),
      },
    };
    dynamodb.scan(params, function (err, data) {
      if (!err) {
        if (Object.keys(data).length > 0 && data.Items.length > 0) {
          resolve(data.Items);
        }
      }
      reject();
    });
  });
};

const getAttendees = async (eventGoogle, dataLogin) => {
  var attendees = [];
  var membersCode = "";
  return new Promise(function (resolve, reject) {
    try {
      if (
        eventGoogle.attendees != undefined &&
        eventGoogle.attendees.length > 0
      ) {
        var attendeesGoogle = eventGoogle.attendees;
        for (let i = 0; i < attendeesGoogle.length; i++) {
          for (let index = 0; index < dataLogin.length; index++) {
            if (
              attendeesGoogle[i].email == dataLogin[index].google_user_email &&
              attendeesGoogle[i].responseStatus != "declined"
            ) {
              attendees.push({
                code: dataLogin[index].kintone_user_code,
                name: dataLogin[index].kintone_user_name,
              });
              membersCode += dataLogin[index].kintone_user_id + ",";
            }
          }
        }
        if (membersCode) {
          membersCode = membersCode.substring(0, membersCode.length - 1);
        }
        resolve({ attendees: attendees, membersCode: membersCode });
      } else {
        resolve({ attendees: attendees, membersCode: membersCode });
      }
    } catch (err) {
      console.log(err);
      reject();
    }
  });
};

const checkChangeDescription = (
  events,
  indexEvent,
  eventData,
  mappingFields
) => {
  if (
    mappingFields.description &&
    ((events[indexEvent].description != undefined &&
      events[indexEvent].description !=
        eventData.record[mappingFields.description].value) ||
      (events[indexEvent].description == undefined &&
        eventData.record[mappingFields.description].value))
  ) {
    return true;
  }
  return false;
};

const checkChangeLocation = (events, indexEvent, eventData, mappingFields) => {
  if (
    mappingFields.location &&
    ((events[indexEvent].location != undefined &&
      events[indexEvent].location !=
        eventData.record[mappingFields.location].value) ||
      (events[indexEvent].location == undefined &&
        eventData.record[mappingFields.location].value))
  ) {
    return true;
  }
  return false;
};

const checkChangeAttendees = (eventData, mappingFields, attendees) => {
  console.log("mappingFields: ", JSON.stringify(mappingFields, null, 2));
  console.log("attendees", JSON.stringify(attendees, null, 2));

  if (mappingFields.attendees) {
    if (
      attendees.length !=
        eventData.record[mappingFields.attendees].value.length ||
      (attendees.length == 0 &&
        eventData.record[mappingFields.attendees].value.length > 0)
    ) {
      return true;
    }
    var attendeesKintone = eventData.record[mappingFields.attendees].value;
    for (let index = 0; index < attendees.length; index++) {
      var exist = false;
      for (let i = 0; i < attendeesKintone.length; i++) {
        if (attendees[index].code == attendeesKintone[i].code) {
          exist = true;
          break;
        }
      }
      if (!exist) {
        return true;
      }
    }
  }

  return false;
};

function checkUpdateTime(kintoneRecord, eventGoogle) {
  let check = false;
  let updateTimeGoogle = new Date(eventGoogle.updated);
  for (let key in kintoneRecord) {
    if (kintoneRecord[key].type == "CREATED_TIME") {
      let updateTimeKintone = new Date(kintoneRecord[key].value);
      if (updateTimeGoogle > updateTimeKintone) check = true;
    }
  }
  return check;
}
const formatISO8601 = (date) => {
  var offset = (function (d) {
    var o = d.getTimezoneOffset() / -60;
    return (0 < o ? "+" : "-") + ("00" + Math.abs(o)).substr(-2) + ":00";
  })(date);

  return [
    [
      date.getFullYear(),
      ("00" + (date.getMonth() + 1)).substr(-2),
      ("00" + date.getDate()).substr(-2),
    ].join("-"),
    "T",
    [
      ("00" + date.getHours()).substr(-2),
      ("00" + date.getMinutes()).substr(-2),
      ("00" + date.getSeconds()).substr(-2),
    ].join(":"),
    offset,
  ].join("");
};

const formatDateISO8601 = (date) => {
  return [
    date.getFullYear(),
    ("00" + (date.getMonth() + 1)).substr(-2),
    ("00" + date.getDate()).substr(-2),
  ].join("-");
};

const getDistanceTwoDates = (startDate, endDate) => {
  const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds

  return Math.round(Math.abs((endDate - startDate) / oneDay));
};

const extractHostname = (url) => {
  var hostname;
  if (url.indexOf("//") > -1) {
    hostname = url.split("/")[2];
  } else {
    hostname = url.split("/")[0];
  }
  hostname = hostname.split(":")[0];
  hostname = hostname.split("?")[0];

  return hostname;
};

const generateId = () => {
  return (
    new Date().getTime().toString() +
    Math.floor(Math.random() * 1000000).toString()
  );
};

const sleep = (time) => {
  return new Promise((resolve) => setTimeout(resolve, time));
};

async function checkAuth(domain, pluginID) {
  let check = true;
  const lambda = new AWS.Lambda({
    region: "us-east-1",
  });

  const params1 = {
    InvocationType: "RequestResponse",
    Payload: JSON.stringify({ domain: domain, pluginID: pluginID }),
    FunctionName: "getPluginAuthState",
  };

  const resp1 = await lambda.invoke(params1).promise();
  console.log("resp1: ", JSON.stringify(resp1));

  let body = JSON.parse(resp1.Payload);

  console.log("body: ", JSON.stringify(body, null, 2));

  console.log("authState: ", body.data.authState);

  console.log("end date: ", body.data.trialEnd);
  if (body.data.authState == "trialStart") {
    let today = new Date();
    let endDate = new Date(body.data.trialEnd);
    if (today > endDate) {
      check = false;
    }
  }

  if (body.data.authState == "trialEnd" || body.data.authState == "NotActive") {
    check = false;
  }

  return check;
}

const listEventsPromise = (params, calendar) => {
  return new Promise((resolve, reject) => {
    calendar.events.list(params, (err, resp) => {
      if (err) {
        reject(err);
      } else {
        resolve(resp.data);
      }
    });
  });
};

