const { expect } = require("@jest/globals");
const googleExpiresUpdate = require("./lamda.js");

test("correct obj", async () => {
  let params = {
    channel_Id:"45612490-7187-11eb-8476-454e353f3f9b",
    resource_Id:"n7xGaNxX7CKQSxOOh3VQuKPE0S0",
    channel_expires_on: "2021-03-14T03:07:26.595Z",
    google_expires_on: "2021-02-12T04:07:26.596Z",
    google_refresh_token:
      "1//0gVzCCB4pJ8vHCgYIARAAGBASNwF-L9IreCeq1B8ECMUPMUfG8jQh2Z2yE2ujSS0yEmoZwnEAldlrBXYvIQzDQsJG3w1sW-dlXlU",
    google_user_email: "hayatoisap10@gmail.com",
    id: "1",
  };
  expect(await googleExpiresUpdate(params)).toBe("success");
});

// test("google_refresh_token is missed", async () => {
//   let params = {
//     channel_expires_on: "2021-03-14T03:07:26.595Z",
//     google_expires_on: "2021-02-12T04:07:26.596Z",
//     google_refresh_token:"abcde",
//     google_user_email: "hayatoisap10@gmail.com",
//     id: "1",
//   };
//   const result = googleExpiresUpdate(params)
//   await expect(result).rejects.toThrow("getAccesstoken fail");
// });


// test("google_refresh_token is empty string", async () => {
//   let params = {
//     channel_expires_on: "2021-03-14T03:07:26.595Z",
//     google_expires_on: "2021-02-12T04:07:26.596Z",
//     google_refresh_token:"",
//     google_user_email: "hayatoisap10@gmail.com",
//     id: "1",
//   };
//   const result = googleExpiresUpdate(params)
//   await expect(result).rejects.toThrow("getAccesstoken fail");
// });

// test("google_user_email is missed", async () => {
//   let params = {
//     channel_expires_on: "2021-03-14T03:07:26.595Z",
//     google_expires_on: "2021-02-12T04:07:26.596Z",
//     google_refresh_token:"abcde",
//     google_user_email: "abcde",
//     id: "1",
//   };
//   const result = googleExpiresUpdate(params)
//   await expect(result).rejects.toThrow("getAccesstoken fail");
// });

