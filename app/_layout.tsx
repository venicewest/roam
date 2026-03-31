// app/_layout.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StripeWrapper } from "../components/StripeWrapper";
import { Audio } from "expo-av";
import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Linking } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../services/supabase";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function RootLayoutNav() {
  const { user, loading, pendingPasswordRecovery } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    // /join is a public guest page — never redirect to login
    if (pathname.startsWith("/join")) return;
    if (pendingPasswordRecovery) {
      router.replace("/(auth)/forgot-password");
      return;
    }
    if (!user) {
      router.replace("/(auth)/login");
    }
  }, [user, loading, pendingPasswordRecovery, pathname]);

  // Handle deep links: roam://reset-password navigates to forgot-password step 2.
  // Supabase sends this URL after the user clicks the reset email link.
  useEffect(() => {
    const handleUrl = (url: string) => {
      if (url.includes("reset-password") || url.includes("type=recovery")) {
        // Extract the token fragment and let Supabase handle session recovery,
        // then navigate to forgot-password which detects the active session.
        supabase.auth.getSession().then(({ data }) => {
          if (data.session) {
            router.replace("/(auth)/forgot-password");
          }
        });
      }
    };

    // Handle cold-start deep link
    Linking.getInitialURL().then((url) => { if (url) handleUrl(url); });

    // Handle foreground deep link
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  }, []);

  if (loading) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="tour/[session_id]"
          options={{
            headerShown: false,
            gestureEnabled: false,
            animation: "slide_from_bottom",
          }}
        />
        <Stack.Screen
          name="transcript/[session_id]"
          options={{
            headerShown: true,
            title: "Tour Transcript",
            headerStyle: { backgroundColor: "#1a1a2e" },
            headerTintColor: "#ffffff",
          }}
        />
        <Stack.Screen
          name="join/index"
          options={{
            headerShown: false,
            presentation: "fullScreenModal",
          }}
        />
        <Stack.Screen
          name="voice-selector"
          options={{
            headerShown: false,
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="billing-history"
          options={{
            headerShown: true,
            title: "Billing history",
            headerStyle: { backgroundColor: "#1a1a2e" },
            headerTintColor: "#ffffff",
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <StripeWrapper>
      <QueryClientProvider client={queryClient}>
        <RootLayoutNav />
      </QueryClientProvider>
    </StripeWrapper>
  );
}
