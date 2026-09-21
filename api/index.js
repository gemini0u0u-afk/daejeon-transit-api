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

// 노선 정류장 데이터 캐시 (서버 부하 및 트래픽 절약)
const routeStationCache = {};

// 1. 메인 웹페이지 서빙
app.get('/', (req, res) => {
  const filePath = path.join(process.cwd(), 'index.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.send('대전 버스 실시간 관제 서버 가동 중');
});

// 2. 노선별 경유 정류소 조회 API (실제 굴곡 경로선 생성용)
app.get('/api/bus/stations', async (req, res) => {
  const routeId = req.query.routeId || '30300001';
  const serviceKey = process.env.PUBLIC_SERVICE_KEY;

  if (!serviceKey) {
    return res.status(500).json({ status: 'error', message: 'PUBLIC_SERVICE_KEY 환경변수가 없습니다.' });
  }

  // 캐시된 정류소 데이터가 있으면 즉시 반환
  if (routeStationCache[routeId]) {
    return res.json({
      status: 'success',
      cached: true,
      routeId,
      stations: routeStationCache[routeId]
    });
  }

  const rawKey = serviceKey.trim();
  const requestUrl = `https://apis.data.go.kr/6300000/busRouteInfo/getStaionByRoute?serviceKey=${rawKey}&busRouteId=${routeId}`;

  try {
    const response = await axios.get(requestUrl, { timeout: 10000 });
    const xmlData = response.data;

    parser.parseString(xmlData, (err, result) => {
      if (err) {
        return res.status(500).json({ status: 'error', message: 'XML 파싱 실패', raw: xmlData });
      }

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({ status: 'success', routeId, stations: [] });
      }

      const rawList = Array.isArray(body.itemList) ? body.itemList : [body.itemList];

      const stations = rawList.map(item => ({
        stationId: item.BUS_STOP_ID || item.STATION_ID || item.busStopId,
        stationName: item.BUSSTOP_NM || item.STATION_NM || item.busStopNm,
        seq: parseInt(item.BUSSTOP_SEQ || item.STATION_SEQ || item.seq || '0', 10),
        lat: parseFloat(item.GPS_LATI || item.LAT || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.LONG || item.lng || 0)
      })).filter(s => s.lat > 35.0 && s.lng > 126.0)
        .sort((a, b) => a.seq - b.seq);

      // 캐시 저장 (메모리 보관)
      routeStationCache[routeId] = stations;

      return res.json({
        status: 'success',
        cached: false,
        routeId,
        count: stations.length,
        stations
      });
    });
  } catch (error) {
    res.status(502).json({
      status: 'error',
      message: '정류소 데이터 수신 실패',
      detail: error.message
    });
  }
});

// 3. 실시간 버스 위치 조회 API
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
          message: cmmHeader.returnAuthMsg
        });
      }

      const body = result?.ServiceResult?.msgBody;
      if (!body || !body.itemList) {
        return res.json({
          status: 'success',
          routeId,
          count: 0,
          vehicles: [],
          message: '운행 중인 차량이 없습니다.'
        });
      }

      const rawList = Array.isArray(body.itemList) ? body.itemList : [body.itemList];

      const formattedVehicles = rawList.map(item => ({
        busId: item.BUS_ID || item.busId,
        plateNo: item.CAR_REG_NO || item.plateNo || '대전버스',
        routeId,
        lat: parseFloat(item.GPS_LATI || item.lat || 0),
        lng: parseFloat(item.GPS_LONG || item.lng || 0),
        stopSeq: parseInt(item.STATION_ORD || item.stopSeq || '0', 10),
        updatedAt: new Date().toISOString()
      })).filter(v => v.lat > 35.0 && v.lng > 126.0);

      return res.json({
        status: 'success',
        routeId,
        count: formattedVehicles.length,
        vehicles: formattedVehicles
      });
    });

  } catch (error) {
    res.status(502).json({
      status: 'error',
      statusCode: error.response?.status,
      message: error.message
    });
  }
});

module.exports = app;
