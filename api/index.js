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

// 메모리 캐시
const routeStationCache = {};
let routeMasterCache = null;

// 메인 웹페이지 서빙
app.get('/', (req, res) => {
  const filePath = path.join(process.cwd(), 'index.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.send('대전 대중교통 관제 서버 가동 중');
});

// 1. 신규 API: 운송업체별 노선 현황 연동 (공공데이터 JSON API)
app.get('/api/bus/company-routes', async (req, res) => {
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'API 키 누락' });

  if (routeMasterCache) return res.json({ status: 'success', data: routeMasterCache });

  const url = `https://api.odcloud.kr/api/15081779/v1/uddi:17d6b812-94ea-442e-879a-954f1329982e_20230327?page=1&perPage=150&returnType=JSON&serviceKey=${encodeURIComponent(serviceKey)}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    routeMasterCache = response.data.data || [];
    res.json({ status: 'success', data: routeMasterCache });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 2. 노선별 실제 경유 정류소 목록 조회
app.get('/api/bus/stations', async (req, res) => {
  const routeId = req.query.routeId || '30300072'; // 605번 실제 정규 ID
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  if (routeStationCache[routeId]) {
    return res.json({ status: 'success', cached: true, routeId, stations: routeStationCache[routeId] });
  }

  const url = `https://apis.data.go.kr/6300000/busRouteInfo/getStaionByRoute?serviceKey=${serviceKey}&busRouteId=${routeId}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) return res.json({ status: 'success', routeId, stations: [] });

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const stations = list.map(item => ({
        stationId: item.BUS_STOP_ID || item.STATION_ID || item.busStopId,
        stationName: item.BUSSTOP_NM || item.STATION_NM || item.busStopNm,
        seq: parseInt(item.BUSSTOP_SEQ || item.STATION_SEQ || item.seq || '0', 10),
        lat: parseFloat(item.GPS_LATI || item.LAT || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.LONG || item.lng || 0)
      })).filter(s => s.lat > 35.0 && s.lng > 126.0)
        .sort((a, b) => a.seq - b.seq);

      routeStationCache[routeId] = stations;
      res.json({ status: 'success', cached: false, routeId, count: stations.length, stations });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 3. 실시간 버스 주행 위치 조회
app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300072';
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  const url = `https://apis.data.go.kr/6300000/busposinfo/getBusPosByRtid?serviceKey=${serviceKey}&busRouteId=${routeId}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', routeId, count: 0, vehicles: [] });
      }

      const list = Array.isArray(body.itemList) ? body.itemList : [body.itemList];
      const vehicles = list.map(item => ({
        busId: item.BUS_ID || item.busId,
        plateNo: item.CAR_REG_NO || item.plateNo || '대전버스',
        routeId,
        lat: parseFloat(item.GPS_LATI || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.lng || 0),
        stopSeq: parseInt(item.STATION_ORD || item.stopSeq || '0', 10),
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      res.json({ status: 'success', routeId, count: vehicles.length, vehicles });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

// 4. 정류소별 실시간 도착 예정 정보 조회
app.get('/api/bus/arrivals', async (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ status: 'error', message: 'stopId 필요' });

  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();
  const url = `https://apis.data.go.kr/6300000/arrive/getArrInfoByStopID?serviceKey=${serviceKey}&BusStopID=${stopId}`;

  try {
    const response = await axios.get(url, { timeout: 8000 });
    parser.parseString(response.data, (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'XML 파싱 에러' });

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', stopId, count: 0, arrivals: [] });
      }

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
