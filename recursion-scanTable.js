const AWS = require("aws-sdk");
const DynamoDB = new AWS.DynamoDB.DocumentClient({ region: "ap-southeast-1" });
// const tableName = "test-kintone-google-users";

// const main = async (event, context) => {
//   try {
//     // scan用のパラメーターをセット
//     const params = {
//       TableName: tableName,
//       FilterExpression: "channel_id = :channel_id",
//       ExpressionAttributeValues: {
//         ":channel_id": "430eb75a-1c96-4cba-bada-befcd946a930",
//       },
//     };
//     // scanで取得したデータを格納する空の配列を定義しておく
//     let scan_result;
//     const scan = async () => {
//       let result = await DynamoDB.scan(params).promise();
//       if (result.Items.length > 0) {
//         scan_result = result;
//         return true;
//       }

//       // scanリクエストを行なった時にLastEvaluatedKeyがあれば、再帰的にリクエストを繰り返す
//       if (result.LastEvaluatedKey) {
//         params.ExclusiveStartKey = result.LastEvaluatedKey;
//         await scan();
//       } else {
//         return false;
//       }
//     };

//     let boolean = await scan();
//     if (boolean) {
//       return scan_result;
//     } else {
//       throw "can not find specified record";
//     }
//   } catch (err) {
//     console.log(err);
//     return err;
//   }
// };

// async function display() {
//   let items = await main();
//   console.log("出力結果です");
//   console.log(items);
// }

// display();
// const scanDynamo = async (opt) => {
//   try {
//     // scan用のパラメーターをセット
//     const params = opt
//     // scanで取得したデータを格納する空の配列を定義しておく
//     let scan_result;
//     const scan = async () => {
//       let result = await DynamoDB.scan(params).promise();
//       if (result.Items.length > 0) {
//         scan_result = result;
//         return true;
//       }
//       // scanリクエストを行なった時にLastEvaluatedKeyがあれば、再帰的にリクエストを繰り返す
//       if (result.LastEvaluatedKey) {
//         params.ExclusiveStartKey = result.LastEvaluatedKey;
//         await scan();
//       } else {
//         return false;
//       }
//     };

//     let boolean = await scan();
//     if (boolean) {
//       return scan_result;
//     } else {
//       throw "can not find specified record";
//     }
//   } catch (err) {
//     console.log(err);
//     throw err;
//   }
// };


async function main() {
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow = tomorrow.toISOString();
  console.log(tomorrow)

  let params = {
    TableName: "test-recursion",
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
  let users_recors = await scanDynamo(params);
  console.log(users_recors);
  //    users_recors.map(function(element) {
  //     let items  = element.Items
  //     //配列の各要素を2倍にする
  //    console.log(items)
  // });
}

main();

