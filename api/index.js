const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

// 메인 접속(/) 시 index.html 파일 응답
app.get('/', (req, res) => {
  const filePath = path.join(process.cwd(), 'index.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.send('대전 버스 실시간 관제 서버 가동 중');
});

// 버스 위치 API
app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300001';
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;

  if (!serviceKey) {
    return res.status(500).json({ status: 'error', message: 'PUBLIC_SERVICE_KEY 환경변수가 없습니다.' });
  }

  const rawKey = serviceKey.trim();
  const requestUrl = `https://apis.data.go.kr/6300000/busposinfo/getBusPosByRtid?serviceKey=${rawKey}&busRouteId=${routeId}`;

  try {
    const response = await axios.get(requestUrl, { timeout: 10000 });
    const xmlData = response.data;

    parser.parseString(xmlData, (err, result) => {
      if (err) {
        return res.status(500).json({ status: 'error', message: 'XML 파싱 실패', raw: xmlData });
      }

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
