// async function sleepSquareFunc(x) {
//   return new Promise((resolve, reject) => {
//     resolve(x * x)
//   });
// }

// async function SquareFunc(x) {
//   return new Promise((resolve, reject) => {
//     resolve(x * x)
//   });
// }

// async function sumParallelFunc() {
//   const a = sleepSquareFunc(2);
//   const b = SquareFunc(4);
//   const [aa, bb] = await Promise.all([a, b]);
//  console.log((aa + bb) * 2);
// }

// sumParallelFunc()
const axios = require('axios');

async function sleepSquareFunc(x) {
  return new Promise((resolve, reject) => {
    axios.get("https://www.npmjs.com/package/axios").then(function (response) {
      resolve("こここ")
    });
    resolve(x * x);//結局ここの処理だけ行われれば良い。
  });
}

async function main() {
  let result = await sleepSquareFunc(10);
  console.log(result);
}

main();
