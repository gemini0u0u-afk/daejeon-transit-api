const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

app.get('/api/bus/positions', async (req, res) => {
  const busRouteId = req.query.routeId || '30300001'; // 기본: 급행1번
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;
  
  // 대전시 최신 공식 실시간 위치 엔드포인트
  const url = 'http://openapitraffic.daejeon.go.kr/api/rest/busposinfo/getBusPosByRtid';

  try {
    const response = await axios.get(url, {
      params: {
        serviceKey: serviceKey,
        busRouteId: busRouteId
      },
      timeout: 8000
    });

    parser.parseString(response.data, (err, result) => {
      if (err) {
        return res.status(500).json({ status: 'error', message: 'XML 파싱 실패', raw: response.data });
      }

      const header = result?.ServiceResult?.msgHeader;
      const body = result?.ServiceResult?.msgBody;

      // 공공데이터 인증 또는 요청 오류 처리
      if (header && header.headerCd !== '0') {
        return res.json({ 
          status: 'fail', 
          code: header.headerCd, 
          message: header.headerMsg,
          hint: '인증키 확인 또는 Encoding/Decoding 키 교체가 필요할 수 있습니다.'
        });
      }

      if (!body || !body.itemList) {
        return res.json({ status: 'success', count: 0, vehicles: [], message: '현재 운행 중인 차량이 없습니다.' });
      }

      const rawList = Array.isArray(body.itemList) ? body.itemList : [body.itemList];

      const formattedVehicles = rawList.map(item => ({
        busId: item.BUS_ID || item.busId,
        plateNo: item.CAR_REG_NO || item.plateNo || '대전버스',
        routeId: item.ROUTE_CD || busRouteId,
        lat: parseFloat(item.GPS_LATI || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.lng || 0),
        stopSeq: item.STATION_ORD || item.stopSeq,
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 36.0 && v.lng > 127.0);

      return res.json({
        status: 'success',
        routeId: busRouteId,
        count: formattedVehicles.length,
        vehicles: formattedVehicles
      });
    });
  } catch (error) {
    res.status(502).json({ status: 'error', message: error.message });
  }
});

module.exports = app;
