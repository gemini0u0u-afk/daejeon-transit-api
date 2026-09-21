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

// 캐시 저장소 (정류소 목록 등 고정 데이터 절약)
const routeStationCache = {};

// 메인 페이지 서빙
app.get('/', (req, res) => {
  const filePath = path.join(process.cwd(), 'index.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.send('대전 대중교통 관제 서버 가동 중');
});

// 1. 노선별 경유 정류소 목록 조회
app.get('/api/bus/stations', async (req, res) => {
  const routeId = req.query.routeId || '30300075';
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'API 키가 설정되지 않았습니다.' });
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
        arsId: item.BUSSTOP_ENG_NM || item.ARS_ID || item.arsId || '',
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

// 2. 실시간 버스 주행 위치 조회
app.get('/api/bus/positions', async (req, res) => {
  const routeId = req.query.routeId || '30300075';
  const serviceKey = (process.env.PUBLIC_SERVICE_KEY || '').trim();

  if (!serviceKey) return res.status(500).json({ status: 'error', message: 'API 키가 설정되지 않았습니다.' });

  const url = `https://apis.data.go.kr/6300000/busposinfo/getBusPosByRtid?serviceKey=${serviceKey}&busRouteId=${routeId}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
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

// 3. 신규 신청 API 연동: 정류소별 실시간 도착 예정 정보 조회
app.get('/api/bus/arrivals', async (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ status: 'error', message: 'stopId가 필요합니다.' });

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
        routeId: item.ROUTE_NO || item.ROUTE_CD,
        routeName: item.ROUTE_NO || item.busRouteNm,
        dest: item.DESTINATION || '',
        remainMin: item.EXTIME_MIN || item.predictTime1 || '-',
        remainStop: item.EXTIME_SEC ? Math.ceil(parseInt(item.EXTIME_SEC, 10)/60) : (item.STATUS_POS || '-')
      }));

      res.json({ status: 'success', stopId, count: arrivals.length, arrivals });
    });
  } catch (err) {
    res.status(502).json({ status: 'error', message: err.message });
  }
});

module.exports = app;
