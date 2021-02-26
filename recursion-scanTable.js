const AWS = require("aws-sdk");
const DynamoDB = new AWS.DynamoDB.DocumentClient({ region: "ap-southeast-1" });
const tableName = "test-kintone-google-users";

const main = async (event, context) => {
  try {
    // scan用のパラメーターをセット
    const params = {
      TableName: tableName,
      FilterExpression: "channel_id = :channel_id",
      ExpressionAttributeValues: {
        ":channel_id": "430eb75a-1c96-4cba-bada-befcd946a930",
      },
    };
    // scanで取得したデータを格納する空の配列を定義しておく
    let scan_result;
    const scan = async () => {
      let result = await DynamoDB.scan(params).promise();
      if (result.Items.length > 0) {
        scan_result = result;
        return true;
      }

      // scanリクエストを行なった時にLastEvaluatedKeyがあれば、再帰的にリクエストを繰り返す
      if (result.LastEvaluatedKey) {
        params.ExclusiveStartKey = result.LastEvaluatedKey;
        await scan();
      } else {
        return false;
      }
    };

    let boolean = await scan();
    if (boolean) {
      return scan_result;
    } else {
      throw "can not find specified record";
    }
  } catch (err) {
    console.log(err);
    return err;
  }
};

async function display() {
  let items = await main();
  console.log("出力結果です");
  console.log(items);
}

display();

const scanDynamo = async (opt) => {
  try {
    // scan用のパラメーターをセット
    const params = opt
    // scanで取得したデータを格納する空の配列を定義しておく
    let scan_result;
    const scan = async () => {
      let result = await DynamoDB.scan(params).promise();
      if (result.Items.length > 0) {
        scan_result = result;
        return true;
      }
      // scanリクエストを行なった時にLastEvaluatedKeyがあれば、再帰的にリクエストを繰り返す
      if (result.LastEvaluatedKey) {
        params.ExclusiveStartKey = result.LastEvaluatedKey;
        await scan();
      } else {
        return false;
      }
    };

    let boolean = await scan();
    if (boolean) {
      return scan_result;
    } else {
      throw "can not find specified record";
    }
  } catch (err) {
    console.log(err);
    throw err;
  }
};
