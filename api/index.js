const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

// 브라우저 및 Vercel 캐싱 차단 (실시간 최신 데이터 보장)
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

const parser = new xml2js.Parser({ explicitArray: false, trim: true });
const routeStationCache = {};

// 대전 주요 공식 노선 풀
const OFFICIAL_ROUTES = [
  { id: '30300072', name: '605', type: 'trunk', origin: '대전대동문', dest: '갈마아파트', desc: '대전대동문 ↔ 갈마아파트' },
  { id: '30300001', name: '1', type: 'express', origin: '원내동', dest: '신안동', desc: '원내동 ↔ 신안동' },
  { id: '30300002', name: '2', type: 'express', origin: '봉산동', dest: '옥계동', desc: '봉산동 ↔ 옥계동' },
  { id: '30300003', name: '3', type: 'express', origin: '원내동', dest: '정부청사', desc: '원내동 ↔ 정부청사' },
  { id: '30300083', name: '703', type: 'trunk', origin: '신탄진', dest: '정림동', desc: '신탄진 ↔ 정림동' },
  { id: '30300057', name: '213', type: 'branch', origin: '원내동', dest: '대한통운', desc: '원내동 ↔ 대한통운' },
  { id: '30300037', name: '102', type: 'trunk', origin: '수통골', dest: '대전역', desc: '수통골 ↔ 대전역' },
  { id: '30300040', name: '105', type: 'trunk', origin: '충대농대', dest: '판암지구', desc: '충대농대 ↔ 판암지구' },
  { id: '30300041', name: '106', type: 'trunk', origin: '목원대', dest: '비래동', desc: '목원대 ↔ 비래동' },
  { id: '30300043', name: '108', type: 'trunk', origin: '충남대', dest: '낭월동', desc: '충남대 ↔ 낭월동' },
  { id: '30300052', name: '201', type: 'trunk', origin: '원내동', dest: '대전역동광장', desc: '원내동 ↔ 대전역동광장' },
  { id: '30300067', name: '301', type: 'trunk', origin: '봉산동', dest: '오월드', desc: '봉산동 ↔ 오월드' },
  { id: '30300070', name: '311', type: 'trunk', origin: '신대공영', dest: '오월드', desc: '신대공영 ↔ 오월드' },
  { id: '30300076', name: '606', type: 'trunk', origin: '판암지구', dest: '충남대', desc: '판암지구 ↔ 충남대' },
  { id: '30300084', name: '704', type: 'trunk', origin: '원내동', dest: '보령해양', desc: '원내동 ↔ 보령해양' },
  { id: '30300094', name: '802', type: 'trunk', origin: '봉산동', dest: '산성동', desc: '봉산동 ↔ 산성동' },
  { id: '30300062', name: '216', type: 'branch', origin: '원내동', dest: '시청', desc: '원내동 ↔ 시청' },
  { id: '30300078', name: '613', type: 'branch', origin: '비래동', dest: '갈마아파트', desc: '비래동 ↔ 갈마아파트' },
  { id: '30300104', name: '911', type: 'branch', origin: '충남대', dest: '대전컨벤션센터', desc: '충남대 ↔ DCC' }
];

// 1. 노선 목록 API
app.get('/api/bus/routes', (req, res) => {
  res.json({
    status: 'success',
    count: OFFICIAL_ROUTES.length,
    routes: OFFICIAL_ROUTES.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      originName: r.origin,
      destName: r.dest,
      desc: r.desc
    }))
  });
});

// 2. 노선별 경유 정류소 목록 API
app.get('/api/bus/stations', async (req, res) => {
  const routeId = req.query.routeId || '30300072';
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'PUBLIC_SERVICE_KEY 누락' });
  if (routeStationCache[routeId]) {
    return res.json({ status: 'success', cached: true, routeId, stations: routeStationCache[routeId] });
  }

  const url = `https://apis.data.go.kr/6300000/busRouteInfo/getStaionByRoute?serviceKey=${serviceKey}&busRouteId=${routeId}`;
  try {
    const response = await axios.get(url, { timeout: 8000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) return res.json({ status: 'success', routeId, stations: [] });

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const stations = list.map(item => {
        const rawStopId = item.BUSSTOP_ID || item.BUS_STOP_ID || item.STATION_ID || item.BS_ID || item.busStopId || '';
        const rawArsId = item.BUSSTOP_ENG_NM || item.ARS_ID || item.busStopNo || item.BUSSTOP_NO || '';

        return {
          stationId: String(rawStopId).trim(),
          arsId: String(rawArsId).trim(),
          stationName: item.BUSSTOP_NM || item.STATION_NM || '정류소',
          seq: parseInt(item.BUSSTOP_SEQ || item.STATION_SEQ || item.seq || '0', 10),
          lat: parseFloat(item.GPS_LATI || item.LAT || item.lat || 0),
          lng: parseFloat(item.GPS_LONG || item.LONG || item.lng || 0)
        };
      }).filter(s => s.lat > 35.0 && s.lng > 126.0)
        .sort((a, b) => a.seq - b.seq);

      routeStationCache[routeId] = stations;
      res.json({ status: 'success', cached: false, routeId, count: stations.length, stations });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 3. 실시간 버스 주행 위치 API
app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300072';
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'PUBLIC_SERVICE_KEY 누락' });

  const url = `https://apis.data.go.kr/6300000/busposinfo/getBusPosByRtid?serviceKey=${serviceKey}&busRouteId=${routeId}`;
  try {
    const response = await axios.get(url, { timeout: 8000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const cmm = result?.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (cmm) return res.json({ status: 'fail', message: cmm.returnAuthMsg });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', routeId, count: 0, serverTime: new Date().toLocaleTimeString(), vehicles: [] });
      }

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const vehicles = list.map((item, idx) => ({
        busId: String(item.BUS_ID || item.busId || `BUS_${idx}`).trim(),
        plateNo: String(item.CAR_REG_NO || item.plateNo || `대전${idx + 1}`).trim(),
        routeId,
        lat: parseFloat(item.GPS_LATI || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.lng || 0),
        stopSeq: parseInt(item.STATION_ORD || item.stopSeq || '0', 10),
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      res.json({
        status: 'success',
        routeId,
        count: vehicles.length,
        serverTime: new Date().toLocaleTimeString(),
        vehicles
      });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 4. 정류소별 실시간 도착 예정 정보 API
app.get('/api/bus/arrivals', async (req, res) => {
  const stopId = (req.query.stopId || '').trim();
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  if (!stopId || !serviceKey) {
    return res.status(400).json({ status: 'error', message: '정류소 ID 및 인증키가 필요합니다.' });
  }

  const url = `https://apis.data.go.kr/6300000/arrive/getArrInfoByStopID?serviceKey=${serviceKey}&BusStopID=${stopId}`;
  try {
    const response = await axios.get(url, { timeout: 7000 });
    parser.parseString(response.data, async (err, result) => {
      let body = result?.ServiceResult?.msgBody;
      let list = body?.itemList ? (Array.isArray(body.itemList) ? body.itemList : [body.itemList]) : [];

      if (list.length === 0 && stopId.length === 5) {
        try {
          const fallbackUrl = `https://apis.data.go.kr/6300000/arrive/getArrInfoByUid?serviceKey=${serviceKey}&arsId=${stopId}`;
          const fbRes = await axios.get(fallbackUrl, { timeout: 6000 });
          parser.parseString(fbRes.data, (fbErr, fbResult) => {
            const fbBody = fbResult?.ServiceResult?.msgBody;
            if (fbBody && fbBody.itemList) {
              list = Array.isArray(fbBody.itemList) ? fbBody.itemList : [fbBody.itemList];
            }
          });
        } catch (fbE) {}
      }

      const arrivals = list.map(item => {
        const routeNm = item.ROUTE_NO || item.busRouteNm || item.ROUTE_CD || '버스';
        const minVal = item.EXTIME_MIN || item.predictTime1;
        const stopVal = item.STATUS_POS;

        return {
          routeName: String(routeNm),
          dest: item.DESTINATION || item.destNm || '',
          remainMin: minVal ? `${minVal}분` : '곧 도착',
          remainStop: stopVal ? `${stopVal}번째 전` : '진입 중'
        };
      });

      res.json({
        status: 'success',
        stopId,
        count: arrivals.length,
        arrivals
      });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
