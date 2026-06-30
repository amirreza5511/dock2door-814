import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { MapPin, Navigation, CheckCircle, LocateFixed } from 'lucide-react-native';
import C from '@/constants/colors';
import { geocodeAddress, haversineMeters, SITE_RADIUS_METERS, type Coords } from '@/lib/geo';

// react-native-maps does not render on web (needs a Google Maps loader/key), so we
// only pull it in on native and show a graceful fallback on web.
const isWeb = Platform.OS === 'web';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Maps = isWeb ? null : require('react-native-maps');
const MapView = Maps?.default ?? null;
const Marker = Maps?.Marker ?? null;
const Circle = Maps?.Circle ?? null;
const PROVIDER_DEFAULT = Maps?.PROVIDER_DEFAULT ?? undefined;

function distanceLabel(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export default function WorkerArriveScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { address, city, title } = useLocalSearchParams<{
    assignmentId?: string; address?: string; city?: string; title?: string;
  }>();

  const siteLabel = useMemo(
    () => [address, city].filter(Boolean).join(', '),
    [address, city],
  );

  const [site, setSite] = useState<Coords | null>(null);
  const [me, setMe] = useState<Coords | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'noSite'>('loading');
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1) Resolve the job site to coordinates.
      const resolved = siteLabel ? await geocodeAddress(siteLabel) : null;
      if (cancelled) return;
      if (!resolved) {
        setStatus('noSite');
        return;
      }
      setSite(resolved);

      // 2) Start watching the worker's live position.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setStatus('denied');
        return;
      }
      setStatus('ready');

      if (isWeb) {
        try {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (!cancelled) setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        } catch {
          // ignore
        }
        return;
      }

      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 4000 },
        (pos) => {
          if (!cancelled) setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
      );
    })();

    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [siteLabel]);

  const distance = useMemo(
    () => (site && me ? haversineMeters(me, site) : null),
    [site, me],
  );
  const arrived = distance != null && distance <= SITE_RADIUS_METERS;

  const region = useMemo(() => {
    const center = site ?? me;
    if (!center) return undefined;
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [site, me]);

  const openDirections = () => {
    const q = encodeURIComponent(siteLabel);
    Linking.openURL(`https://maps.google.com/?q=${q}`).catch(() => {});
  };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Arrive at site'}</Text>
        <Text style={styles.headerSub} numberOfLines={1}>{siteLabel || 'Job location'}</Text>
      </View>

      {/* Map / fallback */}
      <View style={styles.mapWrap}>
        {status === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={styles.muted}>Locating the job site…</Text>
          </View>
        )}

        {status === 'noSite' && (
          <View style={styles.center}>
            <MapPin size={32} color={C.textMuted} />
            <Text style={styles.muted}>We couldn&apos;t map this address.</Text>
            <TouchableOpacity onPress={openDirections} style={styles.dirBtn}>
              <Navigation size={14} color={C.white} />
              <Text style={styles.dirBtnText}>Open in Maps</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'denied' && (
          <View style={styles.center}>
            <LocateFixed size={32} color={C.textMuted} />
            <Text style={styles.muted}>Location access is off. Enable it to confirm you&apos;re on site.</Text>
          </View>
        )}

        {status === 'ready' && region && (
          isWeb || !MapView ? (
            <View style={styles.center}>
              <View style={[styles.radar, arrived && styles.radarArrived]}>
                <MapPin size={30} color={arrived ? C.green : C.accent} />
              </View>
              <Text style={styles.muted}>
                {distance != null ? `${distanceLabel(distance)} from the site` : 'Getting your position…'}
              </Text>
              <Text style={styles.webNote}>Open on your phone to see the live map.</Text>
            </View>
          ) : (
            <MapView
              style={StyleSheet.absoluteFill}
              provider={PROVIDER_DEFAULT}
              initialRegion={region}
              showsUserLocation
              showsMyLocationButton={false}
            >
              {site && Marker && (
                <Marker coordinate={site} title={title || 'Job site'} description={siteLabel} pinColor={C.accent} />
              )}
              {site && Circle && (
                <Circle
                  center={site}
                  radius={SITE_RADIUS_METERS}
                  strokeColor={arrived ? C.green : C.accent}
                  fillColor={(arrived ? C.green : C.accent) + '22'}
                  strokeWidth={2}
                />
              )}
            </MapView>
          )
        )}
      </View>

      {/* Status banner */}
      <View style={[styles.banner, { paddingBottom: insets.bottom + 16 }, arrived && styles.bannerArrived]}>
        {arrived ? (
          <>
            <View style={styles.bannerIconOk}><CheckCircle size={22} color={C.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitleOk}>You&apos;ve arrived</Text>
              <Text style={styles.bannerSub}>You&apos;re at the job site. Head to My Shifts to clock in.</Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.bannerIcon}><Navigation size={20} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>
                {distance != null ? `${distanceLabel(distance)} away` : 'Tracking your location…'}
              </Text>
              <Text style={styles.bannerSub}>
                Get within {SITE_RADIUS_METERS} m of the site to check in.
              </Text>
            </View>
            <TouchableOpacity onPress={openDirections} style={styles.dirChip} hitSlop={6}>
              <Navigation size={13} color={C.blue} />
              <Text style={styles.dirChipText}>Directions</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: C.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { marginBottom: 6 },
  backBtnText: { fontSize: 14, color: C.accent, fontWeight: '600' as const },
  headerTitle: { fontSize: 20, fontWeight: '800' as const, color: C.text },
  headerSub: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  mapWrap: { flex: 1, backgroundColor: C.card },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { fontSize: 14, color: C.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  webNote: { fontSize: 12, color: C.textMuted, textAlign: 'center' as const },
  radar: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: C.accent,
    backgroundColor: C.accent + '14',
  },
  radarArrived: { borderColor: C.green, backgroundColor: C.green + '18' },
  dirBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10,
  },
  dirBtnText: { color: C.white, fontWeight: '700' as const, fontSize: 14 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 16,
    backgroundColor: C.bgSecondary,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  bannerArrived: { backgroundColor: C.green + '12', borderTopColor: C.green + '40' },
  bannerIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent + '18',
  },
  bannerIconOk: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.green,
  },
  bannerTitle: { fontSize: 15, fontWeight: '800' as const, color: C.text },
  bannerTitleOk: { fontSize: 16, fontWeight: '800' as const, color: C.green },
  bannerSub: { fontSize: 12.5, color: C.textSecondary, marginTop: 2, lineHeight: 17 },
  dirChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.blueDim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
  },
  dirChipText: { fontSize: 12, color: C.blue, fontWeight: '700' as const },
});
