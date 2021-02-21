var AWS = require("aws-sdk");

var docClient = new AWS.DynamoDB.DocumentClient({ region: "ap-southeast-1" });

//必要な項目
//channel_expires_on,channel_id,google_refresh_token
var json = require("./params.json");
let main = () => {
  let table_name = ["test-scaned-google-expires", "test-update-google-expires"];

  for (let i = 0; i < table_name.length; i++) {
    let params = { RequestItems: {} };
    params.RequestItems[table_name[i]] = json;
    docClient.batchWrite(params, function (err, data) {
      if (err) {
        console.log(err);
      } else {
        console.log(data);
      }
    });
  }
};

main();
