import { useEffect } from "react";
import { setMockFailure } from "../../../services/api";

/** Simulates a failing map save while the page is opened with `?mockFailure=mapSave`. */
export function useMapSaveFailureFlag() {
  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get(
      "mockFailure",
    );
    if (failure === "mapSave") {
      setMockFailure("mapSave", true);
      return () => setMockFailure("mapSave", false);
    }
    return undefined;
  }, []);
}
