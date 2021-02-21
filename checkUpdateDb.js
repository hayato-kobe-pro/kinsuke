const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient({ region: "ap-southeast-1" });


let params = {
  TableName: 'test-kintone-google-users',
  Key: { id: '2' },
  UpdateExpression: 'set next_sync_token = :nextSyncToken',
  ExpressionAttributeValues: { ':nextSyncToken': 'CPCmrtCNie0CEPCmrtCNie0CGAUgzNG6qgE=' },
  ReturnValues: 'UPDATED_NEW'}
async function main()
{

  try{
    let allRecords = await docClient.update(params).promise();
    console.log("成功")
    console.log(allRecords)
  }
  catch(err){
    console.log("失敗")
    console.log(err)
  }
  
}

main()