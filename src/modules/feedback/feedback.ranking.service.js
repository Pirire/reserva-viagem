import mongoose from "mongoose";

function feedbackCollection() {
  return mongoose.connection.db.collection("transportfeedbacks");
}

export async function obterRankingMotoristas(limit = 10) {
  const pipeline = [
    {
      $match: {
        status: "respondido"
      }
    },
    {
      $group: {
        _id: "$motoristaId",
        total: { $sum: 1 },
        mediaPontualidade: {
          $avg: {
            $switch: {
              branches: [
                { case: { $eq: ["$ratings.pontualidade", "Excelente"] }, then: 5 },
                { case: { $eq: ["$ratings.pontualidade", "Boa"] }, then: 4 },
                { case: { $eq: ["$ratings.pontualidade", "Regular"] }, then: 3 },
                { case: { $eq: ["$ratings.pontualidade", "Fraca"] }, then: 1 }
              ],
              default: 0
            }
          }
        },
        mediaConducao: {
          $avg: {
            $switch: {
              branches: [
                { case: { $eq: ["$ratings.conducao", "Excelente"] }, then: 5 },
                { case: { $eq: ["$ratings.conducao", "Boa"] }, then: 4 },
                { case: { $eq: ["$ratings.conducao", "Regular"] }, then: 3 },
                { case: { $eq: ["$ratings.conducao", "Fraca"] }, then: 1 }
              ],
              default: 0
            }
          }
        },
        mediaSimpatia: {
          $avg: {
            $switch: {
              branches: [
                { case: { $eq: ["$ratings.simpatia", "Excelente"] }, then: 5 },
                { case: { $eq: ["$ratings.simpatia", "Boa"] }, then: 4 },
                { case: { $eq: ["$ratings.simpatia", "Regular"] }, then: 3 },
                { case: { $eq: ["$ratings.simpatia", "Fraca"] }, then: 1 }
              ],
              default: 0
            }
          }
        },
        mediaQualidade: {
          $avg: {
            $switch: {
              branches: [
                { case: { $eq: ["$ratings.qualidadeGeral", "Excelente"] }, then: 5 },
                { case: { $eq: ["$ratings.qualidadeGeral", "Boa"] }, then: 4 },
                { case: { $eq: ["$ratings.qualidadeGeral", "Regular"] }, then: 3 },
                { case: { $eq: ["$ratings.qualidadeGeral", "Fraca"] }, then: 1 }
              ],
              default: 0
            }
          }
        }
      }
    },
    {
      $addFields: {
        mediaFinal: {
          $avg: [
            "$mediaPontualidade",
            "$mediaConducao",
            "$mediaSimpatia",
            "$mediaQualidade"
          ]
        }
      }
    },
    {
      $sort: {
        mediaFinal: -1
      }
    },
    {
      $limit: limit
    }
  ];

  const ranking = await feedbackCollection().aggregate(pipeline).toArray();

  return ranking.map((item, index) => ({
    posicao: index + 1,
    motoristaId: item._id,
    totalAvaliacoes: item.total,
    media: Number(item.mediaFinal.toFixed(2))
  }));
}