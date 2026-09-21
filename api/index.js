const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300001'; // 급행1번
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;

  if (!serviceKey) {
    return res.status(500).json({ status: 'error', message: 'PUBLIC_SERVICE_KEY 환경변수가 없습니다.' });
  }

  const rawKey = serviceKey.trim();
  // 공식 End Point 규격 적용 (https 및 정확한 오퍼레이션 경로)
  const requestUrl = `https://apis.data.go.kr/6300000/busposinfo/getBusposbyRouteid?serviceKey=${rawKey}&busRouteId=${routeId}`;

  try {
    const response = await axios.get(requestUrl, { timeout: 10000 });
    const xmlData = response.data;

    parser.parseString(xmlData, (err, result) => {
      if (err) {
        return res.status(500).json({ status: 'error', message: 'XML 파싱 실패', raw: xmlData });
      }

      // 1. 공공데이터포털 공통 인증 에러 체크
      const cmmHeader = result?.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (cmmHeader) {
        return res.json({
          status: 'fail',
          source: 'portal',
          code: cmmHeader.returnReasonCode,
          message: cmmHeader.returnAuthMsg,
          detail: cmmHeader.errMsg
        });
      }

      // 2. 대전 버스 응답 체크
      const msgHeader = result?.ServiceResult?.msgHeader;
      if (msgHeader && msgHeader.headerCd !== '0') {
        return res.json({
          status: 'fail',
          source: 'daejeon',
          code: msgHeader.headerCd,
          message: msgHeader.headerMsg
        });
      }

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({
          status: 'success',
          routeId: routeId,
          count: 0,
          vehicles: [],
          message: '현재 운행 중인 버스가 없습니다.'
        });
      }

      const rawList = Array.isArray(body.itemList) ? body.itemList : [body.itemList];

      const formattedVehicles = rawList.map(item => ({
        busId: item.BUS_ID || item.busId,
        plateNo: item.CAR_REG_NO || item.plateNo || '대전버스',
        routeId: routeId,
        lat: parseFloat(item.GPS_LATI || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.lng || 0),
        stopSeq: item.STATION_ORD || item.stopSeq,
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      return res.json({
        status: 'success',
        routeId: routeId,
        count: formattedVehicles.length,
        vehicles: formattedVehicles
      });
    });

  } catch (error) {
    const errorData = error.response ? error.response.data : null;
    res.status(502).json({
      status: 'error',
      statusCode: error.response?.status,
      message: error.message,
      detail: errorData
    });
  }
});

module.exports = app;
