const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

app.get('/api/bus/positions', async (req, res) => {
  const busRouteId = req.query.routeId || '30300001'; // 급행1번
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;
  
  // 공공데이터포털 표준 통합 게이트웨이 엔드포인트
  const url = 'http://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList';

  try {
    const response = await axios.get(url, {
      params: {
        serviceKey: serviceKey,
        cityCode: '25',        // 대전광역시 도시코드
        routeId: 'DJB' + busRouteId, // 표준 대전 노선코드 규격
        _type: 'json'          // JSON 직접 응답 요청
      },
      timeout: 10000
    });

    const data = response.data;
    
    // JSON 응답 처리
    if (data?.response?.header?.resultCode === '00') {
      const items = data.response.body?.items?.item || [];
      const rawList = Array.isArray(items) ? items : [items];

      const formattedVehicles = rawList.map(item => ({
        busId: item.vehicleno || item.nodeid,
        plateNo: item.vehicleno || '대전버스',
        routeId: busRouteId,
        lat: parseFloat(item.gpslati || 0),
        lng: parseFloat(item.gpslong || 0),
        stopSeq: item.nodeord,
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 36.0 && v.lng > 127.0);

      return res.json({
        status: 'success',
        routeId: busRouteId,
        count: formattedVehicles.length,
        vehicles: formattedVehicles
      });
    }

    // 만약 XML로 왔을 경우의 대비 파싱
    if (typeof data === 'string') {
      parser.parseString(data, (err, result) => {
        if (err) return res.status(500).json({ status: 'error', raw: data });
        const body = result?.response?.body?.items?.item || [];
        const rawList = Array.isArray(body) ? body : [body];
        
        const formattedVehicles = rawList.map(item => ({
          busId: item.vehicleno,
          plateNo: item.vehicleno,
          routeId: busRouteId,
          lat: parseFloat(item.gpslati || 0),
          lng: parseFloat(item.gpslong || 0),
          stopSeq: item.nodeord,
          updatedAt: new Date().toISOString()
        })).filter(v => v.lat > 36.0 && v.lng > 127.0);

        return res.json({
          status: 'success',
          routeId: busRouteId,
          count: formattedVehicles.length,
          vehicles: formattedVehicles
        });
      });
      return;
    }

    return res.json({
      status: 'fail',
      header: data?.response?.header || '알 수 없는 응답 형식'
    });

  } catch (error) {
    res.status(502).json({ status: 'error', message: error.message });
  }
});

module.exports = app;
