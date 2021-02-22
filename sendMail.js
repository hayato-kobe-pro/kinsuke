const AWS = require("aws-sdk");

const { MAIL_FROM, IS_LOCAL, MAIL_ADMIN_SYSTEM, FABBI_DEV_EMAIL } = process.env;

exports.sendSyncMail = ({ emailNoti, domain, errorType, subject, idRecordKintone }) => {
  if (IS_LOCAL || !emailNoti || emailNoti == 'default') {
    return;
  }

  const params = {
    Destination: {
      ToAddresses: [emailNoti]
    },
    Message: {
      /* required */
      Body: {
        /* required */
        Text: {
          Charset: "UTF-8",
          Data: `
              ${errorType.msg}\n
              Domain: ${domain}
              Time: ${new Date().toISOString()}\n
              Error code: ${errorType.code}\n
              ${idRecordKintone !== undefined ? 'ID: ' + idRecordKintone + "\n": ''}
              ${subject !== undefined ? 'Title: ' + subject + "\n": ''}`
        }
      },
      Subject: {
        Charset: "UTF-8",
        Data: errorType.subject || "kintone連携システム同期エラーが発生しました。"
      }
    },
    Source: MAIL_FROM /* required */
  };

  const sendPromise =
    new AWS.SES({
      region: "us-east-1",
      apiVersion: "2010-12-01"
    })
      .sendEmail(params)
      .promise();

  // Handle promise's fulfilled/rejected states
  sendPromise
    .catch(err => {
      console.log("err when send mail : ", JSON.stringify(err));
    });
};

exports.sendSystemMailBaseOnDomain = ({ domain, errorType, error }) => {
  if (IS_LOCAL || !MAIL_ADMIN_SYSTEM || !FABBI_DEV_EMAIL) {
    return;
  }

  const params = {
    Destination: {
      ToAddresses: [MAIL_ADMIN_SYSTEM, FABBI_DEV_EMAIL]
    },
    Message: {
      /* required */
      Body: {
        /* required */
        Text: {
          Charset: "UTF-8",
          Data: `
              未知のエラーを検出\n
              Error code: ${errorType.code}\n
              Domain: ${domain}\n
              Time: ${new Date().toISOString()}\n
              `
        }
      },
      Subject: {
        Charset: "UTF-8",
        Data: "【確認せよ！】kintone連携システムエラー発生"
      }
    },
    Source: MAIL_FROM /* required */
  };

  const sendPromise =
    new AWS.SES({
      region: "us-east-1",
      apiVersion: "2010-12-01"
    })
      .sendEmail(params)
      .promise();

  // Handle promise's fulfilled/rejected states
  sendPromise
    .catch(err => {
      console.log("err when send mail : ", JSON.stringify(err));
    });
}

exports.sendSystemMail = ({ errorType, error }) => {
  if (IS_LOCAL || !MAIL_ADMIN_SYSTEM || !FABBI_DEV_EMAIL) {
    return;
  }

  const params = {
    Destination: {
      ToAddresses: [MAIL_ADMIN_SYSTEM, FABBI_DEV_EMAIL]
    },
    Message: {
      /* required */
      Body: {
        /* required */
        Text: {
          Charset: "UTF-8",
          Data: `
              Time: ${new Date().toISOString()}\n
              Error code: ${errorType.code}\n
              ${errorType.msg}\n
              Error detail: \n
              ${typeof error === 'string' ? error : JSON.stringify(error)}`
        }
      },
      Subject: {
        Charset: "UTF-8",
        Data: "【確認せよ！】kintone連携システムエラー発生"
      }
    },
    Source: MAIL_FROM /* required */
  };

  const sendPromise =
    new AWS.SES({
      region: "us-east-1",
      apiVersion: "2010-12-01"
    })
      .sendEmail(params)
      .promise();

  // Handle promise's fulfilled/rejected states
  sendPromise
    .catch(err => {
      console.log("err when send mail : ", JSON.stringify(err));
    });
}
