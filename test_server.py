import pytest
from server import identify_block_logic, AnchorFilter, ZoneStabilizer, THRESH_FRONT, THRESH_MIDDLE

# Testing the boundaries between Front and Middle rows
# Front threshold is -55
def test_boundary_front_vs_middle():
    # stronger than -55 should be front
    res_front = identify_block_logic(-50, -90, -90)
    assert "1" in res_front or "2" in res_front or "3" in res_front

    # -56 is weaker than -55 so it should be middle
    res_middle = identify_block_logic(-56, -90, -90)
    assert "4" in res_middle or "5" in res_middle or "6" in res_middle

# Testing the boundaries between Middle and Back rows
# Middle threshold is -60
def test_boundary_middle_vs_back():
    # -59 is still middle
    res_mid = identify_block_logic(-59, -90, -90)
    assert "4" in res_mid or "5" in res_mid or "6" in res_mid

    # -61 is weaker than -60 so it should be back
    res_back = identify_block_logic(-61, -90, -90)
    assert "7" in res_back or "8" in res_back or "9" in res_back

# If signals are equal, left should win based on our list order
def test_tie_breaker_left_vs_center():
    # both are strong (-40)
    result = identify_block_logic(-40, -40, -90)
    # should pick Block 1 (Left)
    assert result == "Block 1"

# If center and right are equal, center wins
def test_tie_breaker_center_vs_right():
    result = identify_block_logic(-90, -50, -50)
    assert result == "Block 2"

# Test weird positive value bug
def test_extreme_positive_rssi():
    # if we get +10 rssi it should still count as strong
    result = identify_block_logic(10, -90, -90)
    assert "1" in result or "2" in result or "3" in result

# Test when no sensors pick up anything
def test_dead_silence():
    # if all are -999 it returns Unknown
    result = identify_block_logic(-999, -999, -999)
    assert result == "Unknown"

# Testing the stabilizer buffer
def test_stabilizer_fill_up():
    stab = ZoneStabilizer()

    # adding just 4 items, buffer isn't full yet
    for _ in range(4):
        res = stab.update("Block 1")

    # should just return the last item since it can't vote yet
    assert res == "Block 1"

# Make sure one random bad reading doesn't change the zone
def test_stabilizer_ignores_glitch():
    stab = ZoneStabilizer()

    # fill it with block 1
    for _ in range(8):
        stab.update("Block 1")

    # send one block 9
    output = stab.update("Block 9")

    # should still say block 1
    assert output == "Block 1"
