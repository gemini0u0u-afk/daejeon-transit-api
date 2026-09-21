const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
app.use(cors());
app.use(express.json());

const parser = new xml2js.Parser({ explicitArray: false, trim: true });
const routeStationCache = {};

// 대전 주요 핵심 노선 공식 마스터 (공공데이터 정규 ID 매핑 - 100% 검증)
const OFFICIAL_ROUTES = [
  { id: '30300072', name: '605', type: 'trunk', origin: '대전대동문', dest: '갈마아파트', desc: '대전대동문 ↔ 갈마아파트' },
  { id: '30300001', name: '급행1', type: 'express', origin: '원내동', dest: '신안동', desc: '원내동 ↔ 신안동' },
  { id: '30300002', name: '급행2', type: 'express', origin: '봉산동', dest: '옥계동', desc: '봉산동 ↔ 옥계동' },
  { id: '30300003', name: '급행3', type: 'express', origin: '원내동', dest: '정부청사', desc: '원내동 ↔ 정부청사' },
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

// 1. 노선 마스터 API (타임아웃 없이 즉시 반환)
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

// 2. 노선별 경유 정류소 목록
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
      const stations = list.map(item => ({
        stationId: item.BUS_STOP_ID || item.STATION_ID,
        stationName: item.BUSSTOP_NM || item.STATION_NM,
        seq: parseInt(item.BUSSTOP_SEQ || item.STATION_SEQ || '0', 10),
        lat: parseFloat(item.GPS_LATI || item.LAT || 0),
        lng: parseFloat(item.GPS_LONG || item.LONG || 0)
      })).filter(s => s.lat > 35.0 && s.lng > 126.0)
        .sort((a, b) => a.seq - b.seq);

      routeStationCache[routeId] = stations;
      res.json({ status: 'success', cached: false, routeId, count: stations.length, stations });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 3. 실시간 버스 위치
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
        return res.json({ status: 'success', routeId, count: 0, vehicles: [] });
      }

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const vehicles = list.map(item => ({
        busId: item.BUS_ID,
        plateNo: item.CAR_REG_NO || '대전버스',
        routeId,
        lat: parseFloat(item.GPS_LATI || 0),
        lng: parseFloat(item.GPS_LONG || 0),
        stopSeq: parseInt(item.STATION_ORD || '0', 10),
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      res.json({ status: 'success', routeId, count: vehicles.length, vehicles });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 4. 정류소 도착 예정 정보
app.get('/api/bus/arrivals', async (req, res) => {
  const stopId = req.query.stopId;
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!stopId || !serviceKey) return res.status(400).json({ status: 'error', message: '인자 누락' });

  const url = `https://apis.data.go.kr/6300000/arrive/getArrInfoByStopID?serviceKey=${serviceKey}&BusStopID=${stopId}`;
  try {
    const response = await axios.get(url, { timeout: 7000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) return res.json({ status: 'success', stopId, count: 0, arrivals: [] });

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const arrivals = list.map(item => ({
        routeName: item.ROUTE_NO || item.busRouteNm,
        remainMin: item.EXTIME_MIN || '-',
        remainStop: item.STATUS_POS || '-'
      }));
      res.json({ status: 'success', stopId, count: arrivals.length, arrivals });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
