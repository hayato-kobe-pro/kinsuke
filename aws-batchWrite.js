var AWS = require("aws-sdk");

var docClient = new AWS.DynamoDB.DocumentClient({ region: "ap-southeast-1" });

//必要な項目
//channel_expires_on,channel_id,google_refresh_token
var json = require("./scanParams.json");

let main = () => {
  let table_name = "test-recursion";
  let j = 0;
  let result = [];

  for (let i = 0; i < json.length / 25; i++) {
    result.push(json.slice(j, j + 25));
    j += 25;
  }

  for (let i = 0; i < result.length; i++) {
    let params = { RequestItems: {} };
    params.RequestItems[table_name] = result[i];
    docClient.batchWrite(params, function (err, data) {
      if (err) {
        console.log(err);
      } else {
        console.log(data);
      }
    });
    console.log(params);
  }
};

main();
