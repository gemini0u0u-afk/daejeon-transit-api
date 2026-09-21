const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });

app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300001'; // 급행1번 기본값
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;

  if (!serviceKey) {
    return res.status(500).json({ status: 'error', message: 'Vercel 환경변수에 PUBLIC_SERVICE_KEY가 없습니다.' });
  }

  // axios가 인증키 안의 특수문자를 임의로 변형하지 못하도록 URL 직결 구성
  const rawKey = serviceKey.trim();
  const requestUrl = `http://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList?serviceKey=${rawKey}&cityCode=25&routeId=DJB${routeId}&_type=json`;

  try {
    const response = await axios.get(requestUrl, { timeout: 10000 });
    const data = response.data;

    // 1. JSON 형식 응답 처리
    if (data?.response?.header?.resultCode === '00') {
      const items = data.response.body?.items?.item || [];
      const rawList = Array.isArray(items) ? items : (items ? [items] : []);

      const vehicles = rawList.map(item => ({
        busId: item.vehicleno || item.nodeid,
        plateNo: item.vehicleno || '대전버스',
        routeId: routeId,
        lat: parseFloat(item.gpslati || 0),
        lng: parseFloat(item.gpslong || 0),
        stopSeq: item.nodeord,
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      return res.json({
        status: 'success',
        routeId: routeId,
        count: vehicles.length,
        vehicles: vehicles
      });
    }

    // 2. XML 형식 응답 처리 (포털 설정에 따라 XML로 올 경우)
    if (typeof data === 'string') {
      return parser.parseString(data, (err, parsed) => {
        if (err) return res.status(500).json({ status: 'error', raw: data });
        
        const resHeader = parsed?.response?.header;
        if (resHeader?.resultCode !== '00') {
          return res.json({ 
            status: 'fail', 
            code: resHeader?.resultCode, 
            message: resHeader?.resultMsg,
            tip: 'Decoding 키 대신 Encoding 키를 Vercel 환경변수에 입력해 보세요.'
          });
        }

        const items = parsed?.response?.body?.items?.item || [];
        const rawList = Array.isArray(items) ? items : (items ? [items] : []);

        const vehicles = rawList.map(item => ({
          busId: item.vehicleno,
          plateNo: item.vehicleno,
          routeId: routeId,
          lat: parseFloat(item.gpslati || 0),
          lng: parseFloat(item.gpslong || 0),
          stopSeq: item.nodeord,
          updatedAt: new Date().toISOString()
        })).filter(v => v.lat > 35.0 && v.lng > 126.0);

        return res.json({
          status: 'success',
          routeId: routeId,
          count: vehicles.length,
          vehicles: vehicles
        });
      });
    }

    return res.json({ status: 'fail', rawResponse: data });

  } catch (error) {
    // 403 등 세부 에러 본문 추출
    const errorData = error.response ? error.response.data : null;
    res.status(502).json({
      status: 'error',
      statusCode: error.response?.status,
      detail: errorData || error.message,
      tip: '만약 403이 지속되면 Vercel 환경변수의 키를 Encoding 키로 바꿔보세요.'
    });
  }
});

module.exports = app;
