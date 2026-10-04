import {afterEach,it,expect,vi} from "vitest";
import {googleMaps} from "../lib/integrations/googleMaps";
afterEach(()=>vi.restoreAllMocks());
it("distinguishes failed Details from a successful response without contact information",async()=>{
 vi.spyOn(googleMaps,"placeDetails").mockResolvedValueOnce(null).mockRejectedValueOnce(Error("network")).mockResolvedValueOnce({});
 const result=await googleMaps.enrichTopN([{name:"A",place_id:"a"},{name:"B",place_id:"b"},{name:"C",place_id:"c"}],3);
 expect(result.map(r=>r.detailsUnavailable)).toEqual([true,true,false]);
});
